import { nowIso } from './db.js';
import { isWalletAddress, normalizeAddress } from './wallet-verify.js';

export function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export function parseRateLimitConfig(env) {
  return {
    walletPerMin: Math.max(1, parseInt(env.OAO_RATE_WALLET_PER_MIN, 10) || 10),
    walletPerHour: Math.max(5, parseInt(env.OAO_RATE_WALLET_PER_HOUR, 10) || 100),
    ipPerMin: Math.max(1, parseInt(env.OAO_RATE_IP_PER_MIN, 10) || 20),
    ipPerHour: Math.max(5, parseInt(env.OAO_RATE_IP_PER_HOUR, 10) || 200),
    anonPerMin: Math.max(1, parseInt(env.OAO_RATE_ANON_PER_MIN, 10) || 3),
    anonPerHour: Math.max(3, parseInt(env.OAO_RATE_ANON_PER_HOUR, 10) || 20),
    dailyAlertThreshold: Math.max(50, parseInt(env.OAO_GLM_DAILY_ALERT, 10) || 500),
  };
}

function sinceIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

async function countRecentCalls(db, { wallet, ip, sinceMs }) {
  const since = sinceIso(sinceMs);
  try {
    if (wallet && isWalletAddress(wallet)) {
      const row = await db.prepare(
        `SELECT COUNT(*) AS c FROM glm_call_logs
         WHERE wallet_address = ? AND created_at >= ? AND success = 1`
      ).bind(normalizeAddress(wallet), since).first();
      return row?.c || 0;
    }
    const row = await db.prepare(
      `SELECT COUNT(*) AS c FROM glm_call_logs
       WHERE client_ip = ? AND created_at >= ? AND success = 1`
    ).bind(ip || 'unknown', since).first();
    return row?.c || 0;
  } catch (_) {
    return 0;
  }
}

export async function logRateLimitEvent(db, { identifier, identifierType, reason, endpoint, meta }) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO rate_limit_events (identifier, identifier_type, reason, endpoint, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    identifier,
    identifierType,
    reason,
    endpoint || '/glm/chat',
    meta ? JSON.stringify(meta) : null,
    nowIso()
  ).run();
}

export async function checkGlmRateLimit(db, env, request, meta) {
  if (!db) return null;
  const config = parseRateLimitConfig(env);
  const ip = getClientIp(request);
  const wallet = meta?.userId ? normalizeAddress(meta.userId) : '';
  const hasWallet = isWalletAddress(wallet);

  const checks = [];

  if (hasWallet) {
    checks.push({
      type: 'wallet',
      identifier: wallet,
      perMin: config.walletPerMin,
      perHour: config.walletPerHour,
    });
  } else {
    checks.push({
      type: 'ip_anon',
      identifier: ip,
      perMin: config.anonPerMin,
      perHour: config.anonPerHour,
    });
  }

  checks.push({
    type: 'ip',
    identifier: ip,
    perMin: config.ipPerMin,
    perHour: config.ipPerHour,
  });

  for (const check of checks) {
    const minCount = await countRecentCalls(db, {
      wallet: check.type === 'wallet' ? check.identifier : null,
      ip: check.type === 'wallet' ? null : check.identifier,
      sinceMs: 60000,
    });
    if (minCount >= check.perMin) {
      await logRateLimitEvent(db, {
        identifier: check.identifier,
        identifierType: check.type,
        reason: 'rate_limit_per_minute',
        endpoint: '/glm/chat',
        meta: { count: minCount, limit: check.perMin },
      });
      return {
        error: 'rate_limited',
        message: '请求过于频繁，请稍后再试（1 分钟限流）。',
        message_en: 'Too many requests. Please try again in a minute.',
        retryAfterSec: 60,
        scope: check.type,
      };
    }

    const hourCount = await countRecentCalls(db, {
      wallet: check.type === 'wallet' ? check.identifier : null,
      ip: check.type === 'wallet' ? null : check.identifier,
      sinceMs: 3600000,
    });
    if (hourCount >= check.perHour) {
      await logRateLimitEvent(db, {
        identifier: check.identifier,
        identifierType: check.type,
        reason: 'rate_limit_per_hour',
        endpoint: '/glm/chat',
        meta: { count: hourCount, limit: check.perHour },
      });
      return {
        error: 'rate_limited',
        message: '本小时调用次数已达上限，请稍后再试。',
        message_en: 'Hourly quota exceeded. Please try again later.',
        retryAfterSec: 3600,
        scope: check.type,
      };
    }
  }

  return null;
}

export async function insertGlmCallLog(db, row) {
  if (!db) return;
  try {
    await db.prepare(
      `INSERT INTO glm_call_logs (
        wallet_address, client_ip, source, success,
        input_chars, output_chars, duration_ms, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.walletAddress || null,
      row.clientIp || 'unknown',
      row.source || 'glm_chat',
      row.success ? 1 : 0,
      row.inputChars || 0,
      row.outputChars || 0,
      row.durationMs || 0,
      row.errorCode || null,
      nowIso()
    ).run();
  } catch (err) {
    console.warn('[GLM] call log insert failed:', err);
  }
}

export async function maybeCreateUsageAlert(db, env) {
  if (!db) return null;
  const config = parseRateLimitConfig(env);
  const since = sinceIso(86400000);
  const row = await db.prepare(
    `SELECT COUNT(*) AS c FROM glm_call_logs WHERE created_at >= ? AND success = 1`
  ).bind(since).first();
  const count = row?.c || 0;
  if (count < config.dailyAlertThreshold) return null;

  const existing = await db.prepare(
    `SELECT id FROM platform_alerts
     WHERE acknowledged = 0 AND message LIKE '%24h GLM%'
     AND created_at >= ? LIMIT 1`
  ).bind(since).first();
  if (existing) return null;

  const message = `24h GLM 调用量 ${count} 次，已接近告警阈值 ${config.dailyAlertThreshold}`;
  await db.prepare(
    `INSERT INTO platform_alerts (level, message, metric_value, threshold, acknowledged, created_at)
     VALUES ('warning', ?, ?, ?, 0, ?)`
  ).bind(message, count, config.dailyAlertThreshold, nowIso()).run();
  return { message, count, threshold: config.dailyAlertThreshold };
}

export function getAdminWallets(env) {
  const raw = String(env.OAO_ADMIN_WALLETS || '');
  return raw.split(/[,\s]+/)
    .map((item) => normalizeAddress(item))
    .filter((item) => isWalletAddress(item));
}
