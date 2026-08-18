/**
 * OAO 联网搜索 — Worker 代理 SearXNG（Tunnel）+ Serper 云端备用
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

function filterWikiResults(results, excludeWiki) {
  if (!excludeWiki) return results;
  return results.filter((item) => !/wikipedia\.org|wikimedia\.org|baike\.baidu\.com/i.test(item.url || ''));
}

async function fetchSerperResults(query, apiKey, options = {}) {
  if (!apiKey) return [];
  const lang = options.lang || 'zh-CN';
  const isZh = lang.startsWith('zh');
  try {
    const body = {
      q: query,
      num: 10,
      gl: isZh ? 'cn' : 'us',
      hl: isZh ? 'zh-cn' : 'en',
    };
    if (options.categories === 'news') {
      body.type = 'news';
    }
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const organic = (data.organic || []).map((item) => ({
      title: item.title,
      content: item.snippet,
      url: item.link,
    }));
    const news = (data.news || []).map((item) => ({
      title: item.title,
      content: item.snippet || item.title,
      url: item.link,
    }));
    return [...news, ...organic].filter((item) => item.url);
  } catch (_) {
    return [];
  }
}

async function fetchSearxngResults(origin, query, options) {
  const unified = options.unified === true;
  const searxUrl = new URL(unified ? '/searxng/search' : '/search', origin);
  searxUrl.searchParams.set('q', query);
  searxUrl.searchParams.set('format', 'json');
  searxUrl.searchParams.set('language', options.lang || 'zh-CN');
  searxUrl.searchParams.set('categories', options.categories || 'general');
  if (options.engines) searxUrl.searchParams.set('engines', options.engines);
  if (options.timeRange) searxUrl.searchParams.set('time_range', options.timeRange);

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
      return { error: 'searxng_tunnel_offline', results: [] };
    }
    return { error: 'searxng_upstream_error', results: [], detail: text.slice(0, 200) };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return { error: 'invalid_searxng_json', results: [] };
  }

  return { error: null, results: normalizeSearxResults(data) };
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

  const lang = url.searchParams.get('lang') || 'zh-CN';
  const engines = (url.searchParams.get('engines') || '').trim();
  const categories = (url.searchParams.get('categories') || 'general').trim() || 'general';
  const timeRange = (url.searchParams.get('time_range') || '').trim();
  const excludeWiki = url.searchParams.get('exclude') === 'wiki';
  const unified = !!env.LOCAL_AI_ORIGIN;
  const origin = String(unified ? env.LOCAL_AI_ORIGIN : env.SEARXNG_ORIGIN || '').replace(/\/$/, '');
  const serperKey = String(env.SERPER_API_KEY || '').trim();

  let searxError = null;
  let merged = [];

  if (origin) {
    try {
      const searx = await fetchSearxngResults(origin, query, {
        lang,
        categories,
        engines,
        timeRange,
        unified,
      });
      searxError = searx.error;
      merged = searx.results || [];
    } catch (error) {
      searxError = 'searxng_unreachable';
      merged = [];
    }
  } else {
    searxError = 'searxng_not_configured';
  }

  merged = filterWikiResults(merged, excludeWiki);

  if (merged.length < 3 && serperKey) {
    const serper = await fetchSerperResults(query, serperKey, {
      lang,
      categories,
    });
    const seen = new Set(merged.map((r) => (r.url || '').toLowerCase()));
    serper.forEach((item) => {
      const key = (item.url || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });
  }

  merged = merged.slice(0, 12);

  if (merged.length > 0) {
    return json({
      ok: true,
      query,
      engine: searxError && serperKey ? 'searxng+serper' : (serperKey && searxError ? 'serper' : 'searxng'),
      count: merged.length,
      results: merged,
      searx_warning: searxError || null,
      categories,
      time_range: timeRange || null,
    }, 200, corsHeaders);
  }

  if (searxError === 'searxng_tunnel_offline') {
    return json({
      error: 'searxng_tunnel_offline',
      hint: 'SearXNG 未连通。请双击 OAO服务器.bat（自动启动 Docker + SearXNG）并保持窗口打开',
    }, 502, corsHeaders);
  }

  if (!serperKey) {
    return json({
      error: searxError || 'no_results',
      hint: 'SearXNG 无结果或未运行。请双击 OAO服务器.bat，或在 Worker 配置 SERPER_API_KEY 作为云端备用',
    }, 502, corsHeaders);
  }

  return json({
    error: 'no_results',
    hint: 'SearXNG 与 Serper 均无结果，请更换关键词',
  }, 502, corsHeaders);
}
