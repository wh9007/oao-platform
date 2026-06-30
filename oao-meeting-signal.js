/**
 * OAO 视频会议信令 Worker（Cloudflare Workers + Durable Objects）
 *
 * 部署步骤（Cloudflare Dashboard）：
 * 1. Workers & Pages → 你的 oao-ai Worker → Settings → Durable Objects → 添加绑定
 *    - Binding name: MEETING_ROOM
 *    - Class name: MeetingRoom
 * 2. 将此文件内容合并到 Worker，或在 wrangler.toml 中引用
 * 3. 路由：/meeting 指向本 Worker
 *
 * 客户端 WebSocket 连接示例：
 * wss://oao-ai.wh529007.workers.dev/meeting?room=xxxx&key=yyyy
 */

export class MeetingRoom {
  constructor(state, env) {
    this.state = state;
    this.peers = new Map();
    this.roomKey = '';
    this.recState = 'idle';
  }

  broadcast(message, exceptWs = null) {
    const raw = JSON.stringify(message);
    for (const [, peer] of this.peers) {
      if (peer.ws !== exceptWs && peer.ws.readyState === 1) {
        try {
          peer.ws.send(raw);
        } catch (_) {}
      }
    }
  }

  peerList(exceptPeerId = null) {
    const list = [];
    for (const [peerId, peer] of this.peers) {
      if (peerId === exceptPeerId) continue;
      list.push({ peerId, name: peer.name, role: peer.role });
    }
    return list;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('OAO Meeting Signal OK', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }

    const roomId = url.searchParams.get('room') || 'default';
    const key = url.searchParams.get('key') || '';
    if (!key) {
      return new Response('Missing key', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let selfPeerId = null;

    server.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'join') {
        if (!msg.peerId || !msg.key) return;
        if (msg.key !== key) {
          server.send(JSON.stringify({ type: 'error', message: 'invalid_key' }));
          server.close(4001, 'invalid key');
          return;
        }
        if (!this.roomKey) {
          this.roomKey = msg.key;
        } else if (this.roomKey !== msg.key) {
          server.send(JSON.stringify({ type: 'error', message: 'invalid_key' }));
          server.close(4001, 'invalid key');
          return;
        }

        selfPeerId = msg.peerId;
        this.peers.set(msg.peerId, {
          ws: server,
          name: msg.name || msg.peerId.slice(0, 6),
          role: msg.role || 'guest'
        });

        server.send(JSON.stringify({
          type: 'welcome',
          roomId,
          peers: this.peerList(msg.peerId),
          recState: this.recState
        }));

        this.broadcast({
          type: 'peer-joined',
          peerId: msg.peerId,
          name: msg.name || msg.peerId.slice(0, 6),
          role: msg.role || 'guest'
        }, server);
        return;
      }

      if (!selfPeerId || !this.peers.has(selfPeerId)) return;

      if (msg.type === 'rec-state' && msg.state) {
        this.recState = msg.state;
        this.broadcast({ ...msg, from: selfPeerId }, server);
        return;
      }

      if (['offer', 'answer', 'ice', 'transcript'].includes(msg.type)) {
        if (msg.to) {
          const target = this.peers.get(msg.to);
          if (target?.ws?.readyState === 1) {
            target.ws.send(JSON.stringify({ ...msg, from: selfPeerId }));
          }
        } else {
          this.broadcast({ ...msg, from: selfPeerId }, server);
        }
      }
    });

    server.addEventListener('close', () => {
      if (selfPeerId && this.peers.has(selfPeerId)) {
        this.peers.delete(selfPeerId);
        this.broadcast({ type: 'peer-left', peerId: selfPeerId });
      }
      if (this.peers.size === 0) {
        this.roomKey = '';
        this.recState = 'idle';
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/meeting')) {
      return new Response('Not found', { status: 404 });
    }
    const roomId = url.searchParams.get('room') || 'default';
    const id = env.MEETING_ROOM.idFromName(roomId);
    const stub = env.MEETING_ROOM.get(id);
    return stub.fetch(request);
  }
};
