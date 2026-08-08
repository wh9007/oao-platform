/**
 * OAO 统一 Cloudflare Worker
 *
 * 架构：GitHub Pages（前端）→ 本 Worker（中转 + 鉴权）→ 智谱 GLM / 本机 Tunnel
 *
 * 路由：
 *   GET  /glm/health        智谱代理状态（不含 Key）
 *   POST /glm/chat          智谱 GLM-4.7-Flash 对话（Key 在 Secrets）
 *   /ollama/*               本机 Ollama（经 Tunnel，可选）
 *   /api/* 等               本机 AnythingLLM（经 Tunnel，可选）
 *   /meeting                视频会议信令（Durable Object）
 *   /auth/wechat/config     微信登录（可选）
 *
 * Secrets（Dashboard 或 wrangler secret put）：
 *   ZHIPU_API_KEY           智谱开放平台 API Key（必填，外网 AI 对话/纪要）
 *
 * Variables（Settings → Variables）：
 *   ZHIPU_MODEL             默认 glm-4.7-flash
 *   LLM_ORIGIN / OLLAMA_ORIGIN / ANYTHINGLLM_API_KEY（可选，本机 Tunnel）
 */

import { MeetingRoom } from './meeting-room.js';
import { handleGlmChat, handleGlmHealth } from './glm-handler.js';

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

    if (path.startsWith('/glm/')) {
      if (path === '/glm/health' && request.method === 'GET') {
        return withCors(await handleGlmHealth(env, CORS));
      }
      if (path === '/glm/chat' && request.method === 'POST') {
        return withCors(await handleGlmChat(request, env, CORS));
      }
      return withCors(new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
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
      glm: env.ZHIPU_API_KEY ? 'configured' : 'missing ZHIPU_API_KEY secret',
      model: env.ZHIPU_MODEL || 'glm-4.7-flash',
      endpoints: ['/glm/health', '/glm/chat', '/ollama/*', '/api/*', '/meeting', '/auth/wechat/config'],
      note: 'Set ZHIPU_API_KEY secret for cloud AI. Optional: LLM_ORIGIN + OLLAMA_ORIGIN for home Tunnel.',
    }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  },
};
