/**
 * OAO 统一 Cloudflare Worker
 * - /ollama/*  → 本机 Ollama（经 Tunnel）
 * - /api/* 等  → 本机 AnythingLLM（经 Tunnel）
 * - /meeting   → 视频会议信令（Durable Object）
 * - /auth/*    → 微信登录等（可选）
 *
 * Worker 环境变量（Settings → Variables）：
 *   LLM_ORIGIN    = https://llm.你的域名.com
 *   OLLAMA_ORIGIN = https://ollama.你的域名.com
 *   ANYTHINGLLM_API_KEY = （可选，若 AnythingLLM 需要）
 *   WECHAT_APP_ID / WECHAT_APP_SECRET / WECHAT_REDIRECT_URI（可选）
 */

import { MeetingRoom } from './meeting-room.js';

export { MeetingRoom };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

async function proxyHttp(request, targetOrigin, options = {}) {
  const { stripPrefix = '', injectAuth = '' } = options;
  const src = new URL(request.url);
  let path = src.pathname;
  if (stripPrefix && path.startsWith(stripPrefix)) {
    path = path.slice(stripPrefix.length) || '/';
  }

  const target = new URL(path + src.search, targetOrigin.replace(/\/$/, ''));
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  if (injectAuth && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${injectAuth}`);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  try {
    const upstream = await fetch(target.toString(), init);
    return withCors(upstream);
  } catch (error) {
    return withCors(new Response(
      JSON.stringify({
        error: 'upstream_unreachable',
        message: error?.message || 'Tunnel or local service unavailable',
        target: target.toString(),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    ));
  }
}

async function handleWeChatConfig(env) {
  const enabled = !!(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && env.WECHAT_REDIRECT_URI);
  const body = enabled
    ? {
        enabled: true,
        appId: env.WECHAT_APP_ID,
        scope: 'snsapi_login',
        redirectUri: env.WECHAT_REDIRECT_URI,
      }
    : { enabled: false };
  return withCors(new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }));
}

async function handleMeeting(request, env) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get('room') || 'default';
  const id = env.MEETING_ROOM.idFromName(roomId);
  const stub = env.MEETING_ROOM.get(id);
  return stub.fetch(request);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsPreflight();

    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/auth/wechat/config')) {
      return handleWeChatConfig(env);
    }

    if (path.startsWith('/meeting')) {
      return handleMeeting(request, env);
    }

    if (path.startsWith('/ollama')) {
      const origin = env.OLLAMA_ORIGIN;
      if (!origin) {
        return withCors(new Response(JSON.stringify({
          error: 'OLLAMA_ORIGIN not configured',
          hint: 'Set Worker variable OLLAMA_ORIGIN to your Tunnel hostname for localhost:11434',
        }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
      }
      return proxyHttp(request, origin, { stripPrefix: '/ollama' });
    }

    const llmOrigin = env.LLM_ORIGIN;
    if (llmOrigin) {
      return proxyHttp(request, llmOrigin, {
        injectAuth: env.ANYTHINGLLM_API_KEY || '',
      });
    }

    return withCors(new Response(JSON.stringify({
      service: 'OAO AI Worker',
      status: 'online',
      endpoints: ['/ollama/*', '/api/*', '/meeting', '/auth/wechat/config'],
      note: 'Configure LLM_ORIGIN and OLLAMA_ORIGIN to your Cloudflare Tunnel hostnames.',
    }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  },
};
