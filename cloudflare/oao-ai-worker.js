/**
 * OAO 统一 Cloudflare Worker
 *
 * 架构：GitHub Pages（前端）→ 本 Worker（中转 + 鉴权）→ 智谱 GLM / 本机 Tunnel
 *
 * 路由：
 *   GET  /glm/health              智谱代理状态
 *   POST /glm/chat                智谱 GLM-4.7-Flash 对话
 *   POST /api/user/*              用户数据（D1，需登录 sync）
 *   POST /admin/login             管理员登录
 *   GET  /admin/api/*             管理面板 API（JWT）
 *   /ollama/* /api/*              本机 Tunnel 代理
 *   /meeting                      视频会议信令
 *
 * Secrets:
 *   ZHIPU_API_KEY                 智谱 API Key
 *   OAO_ADMIN_PASSWORD            管理员密码
 *   OAO_ADMIN_JWT_SECRET          管理员 JWT 密钥
 *   OAO_USER_JWT_SECRET           用户 JWT 密钥（可与 ADMIN 分开）
 */

import { MeetingRoom } from './meeting-room.js';
import { handleGlmChat, handleGlmHealth } from './glm-handler.js';
import { handleUserApi } from './user-api.js';
import { handleAdminApi } from './admin-api.js';
import { handleWebSearch } from './web-search-handler.js';
import { FALLBACK_NAV_CSV } from './nav-sites-fallback.js';

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

async function handleGatewayHealth(request, env) {
  const origin = String(env.LOCAL_AI_ORIGIN || env.LLM_ORIGIN || '').replace(/\/$/, '');
  if (!origin) {
    return withCors(new Response(JSON.stringify({
      error: 'LOCAL_AI_ORIGIN not configured',
      hint: 'Set Worker variable LOCAL_AI_ORIGIN to https://llm.wh9007.dpdns.org',
    }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  }
  try {
    const upstream = await fetch(`${origin}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text.slice(0, 300) };
    }
    return withCors(new Response(JSON.stringify({
      ok: upstream.ok,
      status: upstream.status,
      origin,
      gateway: data,
    }), {
      status: upstream.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  } catch (error) {
    return withCors(new Response(JSON.stringify({
      ok: false,
      error: 'gateway_unreachable',
      message: error?.message || 'Local AI gateway unavailable',
      origin,
    }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  }
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

    if (path.startsWith('/api/user/')) {
      return withCors(await handleUserApi(request, env, url, CORS));
    }

    if (path.startsWith('/admin/')) {
      return withCors(await handleAdminApi(request, env, url, CORS));
    }

    if (path === '/nav-sites' && request.method === 'GET') {
      const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1uVxG3qUwmeb5PznGovM2I8GlfYdESGdwEB_TaYqn7jTT8-syGlhHHrVnNxct94GVv-60Y1m7B-Ro/pub?gid=0&single=true&output=csv';
      const extractCsv = (raw) => {
        const text = String(raw || '').replace(/^\uFEFF/, '');
        const idx = text.indexOf('ID,');
        return (idx >= 0 ? text.slice(idx) : text).trim();
      };
      const isCsv = (text) => text.indexOf('ID,') === 0 && text.indexOf(',') > 0 && text[0] !== '<' && text[0] !== '{';
      const csvResponse = (text, maxAge) => withCors(new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'public, max-age=' + String(maxAge || 60),
        },
      }));
      try {
        const urls = [sheetUrl, 'https://r.jina.ai/' + sheetUrl];
        for (const url of urls) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          try {
            const upstream = await fetch(url, {
              headers: {
                Accept: 'text/csv,text/plain,*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              },
              redirect: 'follow',
              signal: ctrl.signal,
            });
            const text = extractCsv(await upstream.text());
            if (upstream.ok && isCsv(text)) return csvResponse(text, 60);
          } catch (_) { /* try next source */ }
          finally {
            clearTimeout(timer);
          }
        }
        if (isCsv(extractCsv(FALLBACK_NAV_CSV))) return csvResponse(extractCsv(FALLBACK_NAV_CSV), 300);
        return withCors(new Response(JSON.stringify({
          error: 'nav_sheet_unreachable',
          message: 'Google Sheets fetch failed',
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }));
      } catch (error) {
        if (isCsv(extractCsv(FALLBACK_NAV_CSV))) return csvResponse(extractCsv(FALLBACK_NAV_CSV), 300);
        return withCors(new Response(JSON.stringify({
          error: 'nav_sheet_unreachable',
          message: error?.message || 'Google Sheets fetch failed',
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }));
      }
    }

    if (path === '/web-search' || path.startsWith('/web-search/')) {
      return withCors(await handleWebSearch(request, env, CORS));
    }

    if (path === '/gateway/health' && request.method === 'GET') {
      return handleGatewayHealth(request, env);
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

    if (path === '/' && request.method === 'GET') {
      return withCors(new Response(JSON.stringify({
        service: 'OAO AI Worker',
        status: 'online',
        glm: env.ZHIPU_API_KEY ? 'configured' : 'missing ZHIPU_API_KEY secret',
        platform: env.DB ? 'd1_bound' : 'd1_missing',
        model: env.ZHIPU_MODEL || 'glm-4.7-flash',
        endpoints: [
          '/glm/health', '/glm/chat',
          '/api/user/sync', '/api/user/me', '/api/user/meetings', '/api/user/translate',
          '/admin/login', '/admin/api/stats', '/admin/api/users',
          '/web-search', '/nav-sites', '/ollama/*', '/api/*', '/meeting', '/auth/wechat/config',
        ],
      }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
    }

    if (path === '/favicon.ico') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (path.startsWith('/ollama')) {
      const unified = !!env.LOCAL_AI_ORIGIN;
      const origin = unified ? env.LOCAL_AI_ORIGIN : env.OLLAMA_ORIGIN;
      if (!origin) {
        return withCors(new Response(JSON.stringify({
          error: unified ? 'LOCAL_AI_ORIGIN not configured' : 'OLLAMA_ORIGIN not configured',
          hint: unified
            ? 'Set Worker variable LOCAL_AI_ORIGIN to your OAO local AI gateway hostname'
            : 'Set Worker variable OLLAMA_ORIGIN to your Tunnel hostname for localhost:11434',
        }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
      }
      return proxyHttp(request, origin, { stripPrefix: unified ? '' : '/ollama' });
    }

    const llmOrigin = env.LOCAL_AI_ORIGIN || env.LLM_ORIGIN;
    if (llmOrigin) {
      return proxyHttp(request, llmOrigin, {
        injectAuth: env.ANYTHINGLLM_API_KEY || '',
      });
    }

    return withCors(new Response(JSON.stringify({
      service: 'OAO AI Worker',
      status: 'online',
      glm: env.ZHIPU_API_KEY ? 'configured' : 'missing ZHIPU_API_KEY secret',
      platform: env.DB ? 'd1_bound' : 'd1_missing',
      model: env.ZHIPU_MODEL || 'glm-4.7-flash',
      endpoints: [
        '/glm/health', '/glm/chat',
        '/api/user/sync', '/api/user/me', '/api/user/meetings', '/api/user/translate',
        '/admin/login', '/admin/api/stats', '/admin/api/users',
        '/web-search', '/nav-sites', '/ollama/*', '/api/*', '/meeting', '/auth/wechat/config',
      ],
    }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
  },
};
