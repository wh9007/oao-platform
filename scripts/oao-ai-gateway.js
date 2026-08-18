#!/usr/bin/env node
/**
 * OAO 本地 AI 统一网关
 *
 * 所有本地 AI 能力统一走 127.0.0.1:3001：
 *   /api/*        -> AnythingLLM (127.0.0.1:3002)
 *   /anythingllm/*-> AnythingLLM (127.0.0.1:3002)
 *   /ollama/*     -> Ollama      (127.0.0.1:11434)
 *   /searxng/*    -> SearXNG     (127.0.0.1:8080)
 *   /search       -> SearXNG     (127.0.0.1:8080)
 *
 * Cloudflare Tunnel 只需要把 llm.wh9007.dpdns.org 指向本端口；
 * Worker 再把 /api、/ollama、/web-search 统一转发到这个网关。
 */
'use strict';

const http = require('http');
const url = require('url');

const HOST = process.env.OAO_GATEWAY_HOST || '127.0.0.1';
const PORT = Number(process.env.OAO_GATEWAY_PORT || 3001);

const SERVICES = {
  anythingllm: {
    base: process.env.OAO_ANYTHINGLLM_UPSTREAM || 'http://127.0.0.1:3002',
    healthPath: '/api/ping',
    label: 'AnythingLLM',
  },
  ollama: {
    base: process.env.OAO_OLLAMA_UPSTREAM || 'http://127.0.0.1:11434',
    healthPath: '/api/tags',
    label: 'Ollama',
  },
  searxng: {
    base: process.env.OAO_SEARXNG_UPSTREAM || 'http://127.0.0.1:8080',
    healthPath: '/search?q=test&format=json',
    label: 'SearXNG',
  },
};

function corsHeaders(extra) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, corsHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }));
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 80 * 1024 * 1024) {
        reject(new Error('request_body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function probeService(service) {
  return new Promise((resolve) => {
    const target = new url.URL(service.healthPath, service.base);
    const req = http.request(target, {
      method: 'GET',
      timeout: 1800,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'OAO-AI-Gateway-Health/1.0',
      },
    }, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 500,
        status: res.statusCode,
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('probe_timeout'));
      resolve({ ok: false, status: 0 });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.end();
  });
}

async function handleHealth(res) {
  const [anythingllm, ollama, searxng] = await Promise.all([
    probeService(SERVICES.anythingllm),
    probeService(SERVICES.ollama),
    probeService(SERVICES.searxng),
  ]);
  const allUp = anythingllm.ok && ollama.ok && searxng.ok;
  sendJson(res, allUp ? 200 : 200, {
    ok: true,
    service: 'oao-ai-gateway',
    version: 1,
    gatewayPort: PORT,
    anythingllm,
    ollama,
    searxng,
    ready: allUp,
  });
}

function proxyTo(req, res, targetBase, stripPrefix) {
  const source = new url.URL(req.url, `http://${HOST}:${PORT}`);
  let pathname = source.pathname || '/';

  if (stripPrefix) {
    if (pathname === stripPrefix || pathname === `${stripPrefix}/`) {
      pathname = '/';
    } else if (pathname.startsWith(`${stripPrefix}/`)) {
      pathname = pathname.slice(stripPrefix.length);
    } else {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
  }

  const target = new url.URL(targetBase);
  target.pathname = pathname;
  target.search = source.search;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  delete headers['cf-connecting-ip'];

  const doProxy = (body) => {
    const proxyReq = http.request(target, {
      method: req.method,
      headers,
      timeout: 180000,
    }, (proxyRes) => {
      const responseHeaders = corsHeaders(proxyRes.headers);
      delete responseHeaders['content-length'];
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('upstream_timeout'));
    });
    proxyReq.on('error', (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 502, {
        error: 'upstream_unreachable',
        message: err?.message || 'upstream error',
        target: target.toString(),
      });
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  };

  if (req.method === 'GET' || req.method === 'HEAD') {
    doProxy(null);
    return;
  }

  readRequestBody(req)
    .then(doProxy)
    .catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 413, { error: 'request_body_too_large', message: err?.message });
      }
    });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const pathname = new url.URL(req.url, `http://${HOST}:${PORT}`).pathname;

  if (pathname === '/health' || pathname === '/gateway/health') {
    handleHealth(res);
    return;
  }

  if (pathname === '/' || pathname === '/gateway') {
    sendJson(res, 200, {
      service: 'oao-ai-gateway',
      status: 'online',
      endpoints: [
        '/health',
        '/api/*',
        '/anythingllm/*',
        '/ollama/*',
        '/searxng/*',
        '/search',
      ],
    });
    return;
  }

  if (pathname.startsWith('/api/') || pathname === '/api') {
    proxyTo(req, res, SERVICES.anythingllm.base, '');
    return;
  }

  if (pathname.startsWith('/anythingllm/') || pathname === '/anythingllm') {
    proxyTo(req, res, SERVICES.anythingllm.base, '/anythingllm');
    return;
  }

  if (pathname.startsWith('/ollama/') || pathname === '/ollama') {
    proxyTo(req, res, SERVICES.ollama.base, '/ollama');
    return;
  }

  if (pathname.startsWith('/searxng/') || pathname === '/searxng') {
    proxyTo(req, res, SERVICES.searxng.base, '/searxng');
    return;
  }

  if (pathname === '/search' || pathname.startsWith('/search/')) {
    proxyTo(req, res, SERVICES.searxng.base, '');
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.on('error', (err) => {
  console.error(`[OAO AI Gateway] listen failed on ${HOST}:${PORT}:`, err.message);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[OAO AI Gateway] http://${HOST}:${PORT}`);
  console.log('[OAO AI Gateway] AnythingLLM ->', SERVICES.anythingllm.base);
  console.log('[OAO AI Gateway] Ollama       ->', SERVICES.ollama.base);
  console.log('[OAO AI Gateway] SearXNG      ->', SERVICES.searxng.base);
});
