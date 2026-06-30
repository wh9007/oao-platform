/**
 * OAO 视频会议信令 Durable Object（从 oao-meeting-signal.js 提取）
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
          'Content-Type': 'text/plain; charset=utf-8',
        },
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
          role: msg.role || 'guest',
        });

        server.send(JSON.stringify({
          type: 'welcome',
          roomId,
          peers: this.peerList(msg.peerId),
          recState: this.recState,
        }));

        this.broadcast({
          type: 'peer-joined',
          peerId: msg.peerId,
          name: msg.name || msg.peerId.slice(0, 6),
          role: msg.role || 'guest',
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
