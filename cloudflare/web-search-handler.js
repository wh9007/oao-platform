/**
 * OAO 联网搜索 — Worker 代理本机 SearXNG（Tunnel）
 * GET /web-search?q=关键词
 * 返回 { ok, results: [{ title, content, url }] }
 */

function json(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  });
}

function normalizeSearxResults(data) {
  const raw = data?.results || data?.organic || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    title: String(item.title || item.name || '').trim(),
    content: String(item.content || item.snippet || item.description || '').trim(),
    url: String(item.url || item.link || '').trim(),
  })).filter((item) => item.url && (item.title || item.content));
}

export async function handleWebSearch(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, corsHeaders);
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
  if (!query) {
    return json({ error: 'query_required', hint: 'Use ?q=your+search' }, 400, corsHeaders);
  }

  const origin = String(env.SEARXNG_ORIGIN || '').replace(/\/$/, '');
  if (!origin) {
    return json({
      error: 'searxng_not_configured',
      hint: 'Set Worker var SEARXNG_ORIGIN to your SearXNG Tunnel URL (e.g. https://search.wh9007.dpdns.org)',
    }, 503, corsHeaders);
  }

  const lang = url.searchParams.get('lang') || 'zh-CN';
  const engines = (url.searchParams.get('engines') || '').trim();
  const searxUrl = new URL('/search', origin);
  searxUrl.searchParams.set('q', query);
  searxUrl.searchParams.set('format', 'json');
  searxUrl.searchParams.set('language', lang);
  searxUrl.searchParams.set('categories', 'general');
  if (engines) {
    searxUrl.searchParams.set('engines', engines);
  }

  try {
    const upstream = await fetch(searxUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'OAO-WebSearch/1.0',
      },
      redirect: 'follow',
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      if (/Error 1033|Cloudflare Tunnel error/i.test(text)) {
        return json({
          error: 'searxng_tunnel_offline',
          hint: 'SearXNG Tunnel 未连接。请运行 OAO服务器.bat 并确认 search 域名路由到 127.0.0.1:8080',
        }, 502, corsHeaders);
      }
      return json({
        error: 'searxng_upstream_error',
        status: upstream.status,
        detail: text.slice(0, 300),
      }, 502, corsHeaders);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return json({ error: 'invalid_searxng_json', detail: text.slice(0, 200) }, 502, corsHeaders);
    }

    const results = normalizeSearxResults(data).slice(0, 10);
    return json({
      ok: true,
      query,
      engine: 'searxng',
      count: results.length,
      results,
      engines: engines || 'general',
    }, 200, corsHeaders);
  } catch (error) {
    return json({
      error: 'searxng_unreachable',
      message: error?.message || 'fetch failed',
      hint: 'Ensure SearXNG runs on :8080 and Tunnel route search.* -> http://127.0.0.1:8080',
    }, 502, corsHeaders);
  }
}
