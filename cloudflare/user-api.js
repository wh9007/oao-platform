import { signJwt, verifyJwt, getBearerToken } from './jwt.js';
import { verifyWalletLogin, normalizeAddress, isWalletAddress } from './wallet-verify.js';
import {
  json,
  upsertUser,
  getUserByAddress,
  insertMeetingRecord,
  listMeetingRecords,
  incrementTranslateUsage,
  getTranslateUsage,
  logUsageEvent,
  isUserBlocked,
} from './db.js';
import { checkBlockedUser } from './usage.js';

const USER_TTL = 86400 * 7;

async function requireUser(request, env) {
  const token = getBearerToken(request);
  const secret = env.OAO_USER_JWT_SECRET || env.OAO_JWT_SECRET;
  if (!token || !secret) return null;
  const payload = await verifyJwt(token, secret);
  if (!payload?.sub || payload.role !== 'user') return null;
  if (!env.DB) return payload;
  const blocked = await isUserBlocked(env.DB, payload.sub);
  if (blocked) return { blocked: true, sub: payload.sub };
  return payload;
}

export async function handleUserApi(request, env, url, corsHeaders) {
  if (!env.DB) {
    return json({ error: 'db_not_configured', hint: 'Bind D1 database OAO_DB' }, 503, corsHeaders);
  }

  const path = url.pathname;

  if (path === '/api/user/sync' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }

    const address = normalizeAddress(body.address || body.userId || '');
    const ensName = String(body.ensName || body.ens || '').trim() || null;
    const authMethod = String(body.authMethod || 'wallet').trim();

    if (!address) return json({ error: 'address_required' }, 400, corsHeaders);

    if (isWalletAddress(address)) {
      const valid = await verifyWalletLogin({
        address: body.address,
        message: body.message,
        signature: body.signature,
      });
      if (!valid) return json({ error: 'invalid_signature' }, 401, corsHeaders);
    } else if (!address.startsWith('wechat_')) {
      return json({ error: 'unsupported_auth' }, 400, corsHeaders);
    }

    const blocked = await checkBlockedUser(env.DB, address);
    if (blocked) return json(blocked, 403, corsHeaders);

    const user = await upsertUser(env.DB, {
      walletAddress: address,
      ensName,
      authMethod: isWalletAddress(address) ? 'wallet' : authMethod,
    });

    const secret = env.OAO_USER_JWT_SECRET || env.OAO_JWT_SECRET;
    if (!secret) {
      return json({ error: 'jwt_secret_missing' }, 503, corsHeaders);
    }

    const token = await signJwt({ sub: address, role: 'user', uid: user.id }, secret, USER_TTL);
    await logUsageEvent(env.DB, {
      userId: user.id,
      walletAddress: address,
      action: 'user_login',
      units: 1,
    });

    return json({
      ok: true,
      token,
      user: {
        id: user.id,
        address: user.wallet_address,
        ensName: user.ens_name,
        loginCount: user.login_count,
        firstLoginAt: user.first_login_at,
        lastLoginAt: user.last_login_at,
      },
    }, 200, corsHeaders);
  }

  const auth = await requireUser(request, env);
  if (auth?.blocked) {
    return json(await checkBlockedUser(env.DB, auth.sub), 403, corsHeaders);
  }
  if (!auth) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const user = await getUserByAddress(env.DB, auth.sub);
  if (!user) return json({ error: 'user_not_found' }, 404, corsHeaders);

  if (path === '/api/user/me' && request.method === 'GET') {
    const translate = await getTranslateUsage(env.DB, user.id);
    return json({
      user: {
        id: user.id,
        address: user.wallet_address,
        ensName: user.ens_name,
        authMethod: user.auth_method,
        loginCount: user.login_count,
        firstLoginAt: user.first_login_at,
        lastLoginAt: user.last_login_at,
      },
      translate: translate || { translate_count: 0, char_count: 0, last_used_at: null },
    }, 200, corsHeaders);
  }

  if (path === '/api/user/meetings' && request.method === 'GET') {
    const meetings = await listMeetingRecords(env.DB, user.id, 50);
    return json({ meetings }, 200, corsHeaders);
  }

  if (path === '/api/user/meetings' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const title = String(body.title || '会议记录').trim().slice(0, 200);
    const summary = String(body.summary || '').trim().slice(0, 8000);
    if (!summary) return json({ error: 'summary_required' }, 400, corsHeaders);
    const durationSec = Math.max(0, parseInt(body.durationSec, 10) || 0);
    const source = String(body.source || 'glm').slice(0, 32);
    const kbArchived = body.kbArchived === true || body.kbArchived === 1 || body.kbArchived === '1';
    const kbDocTitle = String(body.kbDocTitle || '').trim().slice(0, 240) || null;
    const meetingId = String(body.meetingId || '').trim().slice(0, 120) || null;
    const id = await insertMeetingRecord(env.DB, {
      userId: user.id,
      walletAddress: user.wallet_address,
      title,
      summary,
      durationSec,
      source,
      kbArchived,
      kbDocTitle,
      meetingId,
    });
    await logUsageEvent(env.DB, {
      userId: user.id,
      walletAddress: user.wallet_address,
      action: 'meeting_save',
      units: 1,
      meta: { title, source },
    });
    return json({ ok: true, id }, 201, corsHeaders);
  }

  if (path === '/api/user/translate' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }
    const charCount = Math.max(0, parseInt(body.charCount, 10) || 0);
    await incrementTranslateUsage(env.DB, {
      userId: user.id,
      walletAddress: user.wallet_address,
      charCount,
    });
    await logUsageEvent(env.DB, {
      userId: user.id,
      walletAddress: user.wallet_address,
      action: 'translate',
      units: Math.max(1, Math.ceil(charCount / 200)),
      meta: { charCount },
    });
    return json({ ok: true }, 200, corsHeaders);
  }

  return json({ error: 'not_found' }, 404, corsHeaders);
}
