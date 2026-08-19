#!/usr/bin/env node
/**
 * OAO 本地静态服务器（零依赖，不再要求安装 Python）
 * 用法：node scripts/dev-server.js
 * 默认：http://127.0.0.1:8777/OAO.html
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.OAO_DEV_HOST || '127.0.0.1';
const PORT = Number(process.env.OAO_DEV_PORT || 8777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    decoded = '/';
  }

  const relative = decoded === '/' ? 'OAO.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  if (target !== ROOT && !target.startsWith(rootWithSep)) {
    return null;
  }
  return target;
}

const { execSync } = require('child_process');

const NAV_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1uVxG3qUwmeb5PznGovM2I8GlfYdESGdwEB_TaYqn7jTT8-syGlhHHrVnNxct94GVv-60Y1m7B-Ro/pub?gid=0&single=true&output=csv';

function applyWindowsProxy() {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
    process.env.NODE_USE_ENV_PROXY = process.env.NODE_USE_ENV_PROXY || '1';
    return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  }
  if (process.platform !== 'win32') return '';
  try {
    const enable = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    if (!/0x1\b/.test(enable)) return '';
    const serverOut = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    const match = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!match) return '';
    let raw = match[1].trim();
    if (/https?=/i.test(raw)) {
      const part = raw.split(';').find((item) => /^https=/i.test(item))
        || raw.split(';').find((item) => /^http=/i.test(item));
      raw = part ? part.replace(/^https?=/i, '') : raw;
    }
    if (!raw) return '';
    const proxyUrl = /^https?:\/\//i.test(raw) ? raw : ('http://' + raw);
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.NODE_USE_ENV_PROXY = '1';
    if (!process.env.NO_PROXY) process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
    return proxyUrl;
  } catch (_) {
    return '';
  }
}

const NAV_PROXY = applyWindowsProxy();
const { spawn } = require('child_process');

function fetchSheetCsvViaCurl(proxyUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS', '-L', '--max-time', '20',
      '-A', 'OAO-NavSites/1.0',
      '-H', 'Accept: text/csv,text/plain,*/*',
      '-w', '\n__OAO_HTTP__:%{http_code}',
    ];
    if (proxyUrl) args.push('-x', proxyUrl);
    args.push(NAV_SHEET_CSV_URL);
    const child = spawn('curl.exe', args, { windowsHide: true });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const marker = raw.lastIndexOf('\n__OAO_HTTP__:');
      const text = marker >= 0 ? raw.slice(0, marker) : raw;
      const status = marker >= 0 ? Number(raw.slice(marker + 14).trim()) : (code === 0 ? 200 : 0);
      if (!status) {
        reject(new Error(stderr.trim() || 'curl failed'));
        return;
      }
      resolve({ status, text });
    });
  });
}

async function fetchSheetCsv(proxyUrl) {
  try {
    const upstream = await fetch(NAV_SHEET_CSV_URL, {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'OAO-NavSites/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await upstream.text();
    if (upstream.ok && text && !/^\s*</.test(text) && text.includes(',')) {
      return { status: upstream.status, text };
    }
  } catch (_) { /* fall through to curl, which honors the system proxy */ }
  return fetchSheetCsvViaCurl(proxyUrl);
}

async function proxyNavSites(res) {
  try {
    const upstream = await fetchSheetCsv(NAV_PROXY);
    res.writeHead(upstream.status === 200 ? 200 : upstream.status, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(upstream.text);
  } catch (error) {
    res.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      error: 'nav_sheet_unreachable',
      message: error && error.message ? error.message : 'Google Sheets fetch failed',
    }));
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === '/nav-sites') {
    proxyNavSites(res);
    return;
  }

  const target = safePath(requestUrl.pathname);

  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(target, (statErr, stat) => {
    if (statErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    let file = target;
    if (stat.isDirectory()) {
      file = path.join(target, 'index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
    } else if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    };

    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`OAO dev server: http://${HOST}:${PORT}/OAO.html`);
  if (NAV_PROXY) console.log(`OAO nav Google proxy: ${NAV_PROXY}`);
  console.log('Press Ctrl+C or close this window to stop.');
});
