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

function extractNavCsv(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const match = text.match(/ID\s*,\s*网站类型[\s\S]*/);
  return (match ? match[0] : text).trim();
}

function fetchUrlViaCurl(url, proxyUrl, maxTimeSec) {
  return new Promise((resolve, reject) => {
    const limit = String(maxTimeSec || 6);
    const args = [
      '-sS', '-L', '--max-time', limit,
      '-A', 'OAO-NavSites/1.0',
      '-H', 'Accept: text/csv,text/plain,application/json,*/*',
      '-w', '\n__OAO_HTTP__:%{http_code}',
    ];
    if (proxyUrl) args.push('-x', proxyUrl);
    args.push(url);
    const child = spawn('curl.exe', args, { windowsHide: true });
    const chunks = [];
    let stderr = '';
    const killer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
    }, (Number(limit) + 1) * 1000);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const marker = raw.lastIndexOf('\n__OAO_HTTP__:');
      const text = marker >= 0 ? raw.slice(0, marker) : raw;
      const status = marker >= 0 ? Number(raw.slice(marker + 14).trim()) : (code === 0 ? 200 : 0);
      if (!status) {
        reject(new Error(stderr.trim() || 'curl failed'));
        return;
      }
      resolve({ status, text: extractNavCsv(text) });
    });
  });
}

const NAV_WORKER_BASE = 'https://oao-ai.wh529007.workers.dev';
const NAV_WORKER_CSV_URL = NAV_WORKER_BASE + '/nav-sites';
const NAV_JINA_CSV_URL = 'https://r.jina.ai/' + NAV_SHEET_CSV_URL;
const NAV_CACHE_FILE = path.join(ROOT, 'assets', 'data', 'nav-sites.cache.csv');

let navCsvCache = { at: 0, status: 0, text: '' };
let workerNavReady = { at: 0, ok: false };

function isGoodNavCsv(result) {
  return result && result.status === 200 && result.text && /ID\s*,\s*网站类型/.test(result.text) && !/^\s*[<{]/.test(result.text);
}

function readDiskNavCache() {
  try {
    const text = extractNavCsv(fs.readFileSync(NAV_CACHE_FILE, 'utf8'));
    if (/ID\s*,\s*网站类型/.test(text)) return { status: 200, text };
  } catch (_) { /* ignore */ }
  return null;
}

function writeDiskNavCache(text) {
  try {
    fs.mkdirSync(path.dirname(NAV_CACHE_FILE), { recursive: true });
    fs.writeFileSync(NAV_CACHE_FILE, text, 'utf8');
  } catch (_) { /* ignore */ }
}

async function probeWorkerNav() {
  if (workerNavReady.ok && (Date.now() - workerNavReady.at) < 300000) return true;
  try {
    const result = await fetchUrlViaCurl(NAV_WORKER_BASE + '/', '', 4);
    const ok = result.status === 200 && /"\/nav-sites"/.test(result.text);
    workerNavReady = { at: Date.now(), ok };
    return ok;
  } catch (_) {
    workerNavReady = { at: Date.now(), ok: false };
    return false;
  }
}

async function fetchSheetCsv(proxyUrl) {
  if (navCsvCache.text && (Date.now() - navCsvCache.at) < 60000) {
    return { status: navCsvCache.status, text: navCsvCache.text };
  }
  const attempts = [];
  if (await probeWorkerNav()) attempts.push({ url: NAV_WORKER_CSV_URL, proxy: '', time: 8 });
  attempts.push({ url: NAV_JINA_CSV_URL, proxy: '', time: 8 });
  if (proxyUrl) attempts.push({ url: NAV_SHEET_CSV_URL, proxy: proxyUrl, time: 5 });
  attempts.push({ url: NAV_SHEET_CSV_URL, proxy: 'http://127.0.0.1:10808', time: 5 });
  attempts.push({ url: NAV_SHEET_CSV_URL, proxy: '', time: 5 });
  let lastError = new Error('Google Sheets fetch failed');
  for (const attempt of attempts) {
    try {
      const result = await fetchUrlViaCurl(attempt.url, attempt.proxy, attempt.time);
      if (isGoodNavCsv(result)) {
        navCsvCache = { at: Date.now(), status: result.status, text: result.text };
        writeDiskNavCache(result.text);
        return result;
      }
      lastError = new Error('HTTP ' + result.status);
    } catch (err) {
      lastError = err;
    }
  }
  const disk = readDiskNavCache();
  if (disk) {
    navCsvCache = { at: Date.now(), status: 200, text: disk.text };
    return disk;
  }
  throw lastError;
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

function start(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port === 8777 && !process.env.OAO_DEV_PORT) {
      console.log('Port 8777 is busy, using 8779.');
      start(8779);
      return;
    }
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`OAO dev server: http://${HOST}:${port}/OAO.html`);
    if (NAV_PROXY) console.log(`OAO nav proxy: ${NAV_PROXY}`);
    console.log('Press Ctrl+C or close this window to stop.');
  });
}

start(PORT);
