import { signJwt, verifyJwt, getBearerToken } from './jwt.js';
import {
  json,
  listUsersAdmin,
  setUserBlocked,
  getAdminDashboardStats,
  acknowledgePlatformAlert,
} from './db.js';
import { normalizeAddress, verifyWalletLogin, isWalletAddress } from './wallet-verify.js';
import { getAdminWallets } from './rate-limit.js';

const ADMIN_TTL = 86400 * 12;

async function requireAdmin(request, env) {
  const token = getBearerToken(request);
  const secret = env.OAO_ADMIN_JWT_SECRET || env.OAO_JWT_SECRET;
  if (!token || !secret) return null;
  const payload = await verifyJwt(token, secret);
  if (!payload?.role || payload.role !== 'admin') return null;
  return payload;
}

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function handleAdminApi(request, env, url, corsHeaders) {
  const path = url.pathname;

  if (path === '/admin/login' && request.method === 'POST') {
    if (!env.OAO_ADMIN_PASSWORD) {
      return json({ error: 'admin_not_configured', hint: 'Set OAO_ADMIN_PASSWORD secret' }, 503, corsHeaders);
    }
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const password = String(body.password || '');
    if (!safeEqual(password, env.OAO_ADMIN_PASSWORD)) {
      return json({ error: 'invalid_password' }, 401, corsHeaders);
    }
    const secret = env.OAO_ADMIN_JWT_SECRET || env.OAO_JWT_SECRET;
    if (!secret) return json({ error: 'jwt_secret_missing' }, 503, corsHeaders);
    const token = await signJwt({ role: 'admin', sub: 'admin_password' }, secret, ADMIN_TTL);
    return json({ ok: true, token, expiresIn: ADMIN_TTL, method: 'password' }, 200, corsHeaders);
  }

  if (path === '/admin/login/wallet' && request.method === 'POST') {
    const admins = getAdminWallets(env);
    if (!admins.length) {
      return json({
        error: 'admin_wallets_not_configured',
        hint: 'Set OAO_ADMIN_WALLETS secret (comma-separated addresses)',
      }, 503, corsHeaders);
    }
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const address = normalizeAddress(body.address || '');
    if (!isWalletAddress(address)) {
      return json({ error: 'address_required' }, 400, corsHeaders);
    }
    if (!admins.includes(address)) {
      return json({ error: 'not_admin_wallet' }, 403, corsHeaders);
    }
    const valid = await verifyWalletLogin({
      address: body.address,
      message: body.message,
      signature: body.signature,
    });
    if (!valid) return json({ error: 'invalid_signature' }, 401, corsHeaders);

    const secret = env.OAO_ADMIN_JWT_SECRET || env.OAO_JWT_SECRET;
    if (!secret) return json({ error: 'jwt_secret_missing' }, 503, corsHeaders);
    const token = await signJwt({ role: 'admin', sub: address }, secret, ADMIN_TTL);
    return json({ ok: true, token, expiresIn: ADMIN_TTL, method: 'wallet', address }, 200, corsHeaders);
  }

  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401, corsHeaders);

  if (!env.DB) {
    return json({ error: 'db_not_configured' }, 503, corsHeaders);
  }

  if (path === '/admin/api/stats' && request.method === 'GET') {
    const days = Math.min(90, Math.max(7, parseInt(url.searchParams.get('days'), 10) || 14));
    const stats = await getAdminDashboardStats(env.DB, days);
    return json(stats, 200, corsHeaders);
  }

  if (path === '/admin/api/users' && request.method === 'GET') {
    const users = await listUsersAdmin(env.DB, 500);
    return json({ users }, 200, corsHeaders);
  }

  if (path === '/admin/api/alerts/ack' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const alertId = parseInt(body.id, 10);
    if (!alertId) return json({ error: 'id_required' }, 400, corsHeaders);
    await acknowledgePlatformAlert(env.DB, alertId);
    return json({ ok: true, id: alertId }, 200, corsHeaders);
  }

  if (path === '/admin/api/users/block' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const address = normalizeAddress(body.address || '');
    if (!address) return json({ error: 'address_required' }, 400, corsHeaders);
    await setUserBlocked(env.DB, address, true, String(body.reason || '').slice(0, 500));
    return json({ ok: true, address, blocked: true }, 200, corsHeaders);
  }

  if (path === '/admin/api/users/unblock' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const address = normalizeAddress(body.address || '');
    if (!address) return json({ error: 'address_required' }, 400, corsHeaders);
    await setUserBlocked(env.DB, address, false, '');
    return json({ ok: true, address, blocked: false }, 200, corsHeaders);
  }

  return json({ error: 'not_found' }, 404, corsHeaders);
}
