/**
 * 智谱 GLM 代理（Key 仅存 Worker Secrets，前端不可见）
 * 端点：GET /glm/health  POST /glm/chat
 */

import { checkBlockedUser, recordGlmUsage, extractOaoMeta, estimateMessageChars } from './usage.js';
import {
  checkGlmRateLimit,
  getClientIp,
  insertGlmCallLog,
  maybeCreateUsageAlert,
} from './rate-limit.js';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEFAULT_MODEL = 'glm-4.7-flash';
const GLM_UPSTREAM_TIMEOUT_MS = 25000;

function jsonResponse(data, status = 200, corsHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function resolveGlmSource(meta) {
  const action = String(meta?.action || 'glm_chat');
  if (action.includes('minutes') || action.includes('meeting')) return 'meeting_minutes';
  if (action.includes('translate')) return 'translate';
  return 'glm_chat';
}

export async function handleGlmHealth(env, corsHeaders) {
  return jsonResponse({
    ok: !!env.ZHIPU_API_KEY,
    provider: 'zhipu',
    model: env.ZHIPU_MODEL || DEFAULT_MODEL,
    endpoints: ['/glm/health', '/glm/chat'],
    platform: env.DB ? 'd1_ready' : 'd1_missing',
    rateLimit: env.DB ? 'enabled' : 'disabled',
  }, env.ZHIPU_API_KEY ? 200 : 503, corsHeaders);
}

export async function handleGlmChat(request, env, corsHeaders) {
  if (!env.ZHIPU_API_KEY) {
    return jsonResponse({
      error: 'zhipu_not_configured',
      hint: 'Run: npx wrangler secret put ZHIPU_API_KEY',
    }, 503, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
  }

  const { meta, cleanBody } = extractOaoMeta(body);
  const clientIp = getClientIp(request);
  const wallet = meta?.userId ? String(meta.userId).toLowerCase() : null;
  const source = resolveGlmSource(meta);
  const startedAt = Date.now();

  if (meta?.userId && env.DB) {
    const blocked = await checkBlockedUser(env.DB, wallet);
    if (blocked) {
      await insertGlmCallLog(env.DB, {
        walletAddress: wallet,
        clientIp,
        source,
        success: false,
        inputChars: estimateMessageChars(cleanBody.messages),
        outputChars: 0,
        durationMs: Date.now() - startedAt,
        errorCode: 'user_blocked',
      });
      return jsonResponse(blocked, 403, corsHeaders);
    }
  }

  if (env.DB) {
    const limited = await checkGlmRateLimit(env.DB, env, request, meta);
    if (limited) {
      return jsonResponse(limited, 429, corsHeaders);
    }
  }

  const messages = cleanBody.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return jsonResponse({ error: 'messages_required' }, 400, corsHeaders);
  }

  const model = env.ZHIPU_MODEL || DEFAULT_MODEL;
  const stream = cleanBody.stream === true;
  const inputChars = estimateMessageChars(messages);
  const payload = {
    model,
    messages,
    stream,
    temperature: typeof cleanBody.temperature === 'number' ? cleanBody.temperature : 0.7,
    max_tokens: typeof cleanBody.max_tokens === 'number' ? cleanBody.max_tokens : 4096,
    thinking: { type: 'disabled' },
  };

  let upstream;
  try {
    upstream = await fetch(ZHIPU_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ZHIPU_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GLM_UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (env.DB) {
      await insertGlmCallLog(env.DB, {
        walletAddress: wallet,
        clientIp,
        source,
        success: false,
        inputChars,
        outputChars: 0,
        durationMs: Date.now() - startedAt,
        errorCode: 'zhipu_unreachable',
      });
    }
    return jsonResponse({
      error: 'zhipu_unreachable',
      message: error?.message || 'Network error',
    }, 502, corsHeaders);
  }

  const durationMs = Date.now() - startedAt;

  if (upstream.ok && env.DB) {
    try {
      if (stream && upstream.body) {
        await recordGlmUsage(env.DB, { ...meta, model, action: meta?.action || 'glm_chat' }, inputChars, 0);
        await insertGlmCallLog(env.DB, {
          walletAddress: wallet,
          clientIp,
          source,
          success: true,
          inputChars,
          outputChars: 0,
          durationMs,
          errorCode: null,
        });
        await maybeCreateUsageAlert(env.DB, env);
      } else {
        const clone = upstream.clone();
        const text = await clone.text();
        let outputChars = text.length;
        try {
          const parsed = JSON.parse(text);
          const content = parsed?.choices?.[0]?.message?.content || '';
          outputChars = String(content).length || outputChars;
        } catch (_) {}
        await recordGlmUsage(env.DB, { ...meta, model, action: meta?.action || 'glm_chat' }, inputChars, outputChars);
        await insertGlmCallLog(env.DB, {
          walletAddress: wallet,
          clientIp,
          source,
          success: true,
          inputChars,
          outputChars,
          durationMs,
          errorCode: null,
        });
        await maybeCreateUsageAlert(env.DB, env);
      }
    } catch (err) {
      console.warn('[GLM] usage log failed:', err);
    }
  } else if (env.DB) {
    await insertGlmCallLog(env.DB, {
      walletAddress: wallet,
      clientIp,
      source,
      success: false,
      inputChars,
      outputChars: 0,
      durationMs,
      errorCode: 'upstream_' + upstream.status,
    });
  }

  if (stream && upstream.ok && upstream.body) {
    const headers = new Headers(upstream.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    }
    headers.set('Cache-Control', 'no-cache');
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const text = await upstream.text();
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(text, { status: upstream.status, headers });
}
