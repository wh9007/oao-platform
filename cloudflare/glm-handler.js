/**
 * 智谱 GLM 代理（Key 仅存 Worker Secrets，前端不可见）
 * 端点：GET /glm/health  POST /glm/chat
 */

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEFAULT_MODEL = 'glm-4.7-flash';

function jsonResponse(data, status = 200, corsHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

export async function handleGlmHealth(env, corsHeaders) {
  return jsonResponse({
    ok: !!env.ZHIPU_API_KEY,
    provider: 'zhipu',
    model: env.ZHIPU_MODEL || DEFAULT_MODEL,
    endpoints: ['/glm/health', '/glm/chat'],
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

  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return jsonResponse({ error: 'messages_required' }, 400, corsHeaders);
  }

  const model = env.ZHIPU_MODEL || DEFAULT_MODEL;
  const stream = body.stream === true;
  const payload = {
    model,
    messages,
    stream,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
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
    });
  } catch (error) {
    return jsonResponse({
      error: 'zhipu_unreachable',
      message: error?.message || 'Network error',
    }, 502, corsHeaders);
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
