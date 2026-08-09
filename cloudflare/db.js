export function nowIso() {
  return new Date().toISOString();
}

export function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

export async function getUserByAddress(db, walletAddress) {
  return db.prepare(
    'SELECT * FROM users WHERE wallet_address = ? LIMIT 1'
  ).bind(walletAddress).first();
}

export async function getUserById(db, id) {
  return db.prepare(
    'SELECT * FROM users WHERE id = ? LIMIT 1'
  ).bind(id).first();
}

export async function upsertUser(db, { walletAddress, ensName, authMethod }) {
  const now = nowIso();
  const existing = await getUserByAddress(db, walletAddress);
  if (existing) {
    await db.prepare(
      `UPDATE users SET
        ens_name = COALESCE(?, ens_name),
        auth_method = ?,
        login_count = login_count + 1,
        last_login_at = ?,
        updated_at = ?
      WHERE id = ?`
    ).bind(ensName || null, authMethod || 'wallet', now, now, existing.id).run();
    return getUserById(db, existing.id);
  }
  const result = await db.prepare(
    `INSERT INTO users (
      wallet_address, ens_name, auth_method, login_count,
      first_login_at, last_login_at, is_blocked, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)`
  ).bind(
    walletAddress,
    ensName || null,
    authMethod || 'wallet',
    now,
    now,
    now,
    now
  ).run();
  return getUserById(db, result.meta.last_row_id);
}

export async function isUserBlocked(db, walletAddress) {
  const user = await getUserByAddress(db, walletAddress);
  return !!(user && user.is_blocked);
}

export async function insertMeetingRecord(db, {
  userId,
  walletAddress,
  title,
  summary,
  durationSec,
  source,
  kbArchived,
  kbDocTitle,
  meetingId,
}) {
  const now = nowIso();
  const result = await db.prepare(
    `INSERT INTO meeting_records (
      user_id, wallet_address, title, summary, duration_sec, source,
      kb_archived, kb_doc_title, meeting_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId,
    walletAddress,
    title,
    summary,
    durationSec || 0,
    source || 'glm',
    kbArchived ? 1 : 0,
    kbDocTitle || null,
    meetingId || null,
    now
  ).run();
  return result.meta.last_row_id;
}

export async function listMeetingRecords(db, userId, limit = 30) {
  const { results } = await db.prepare(
    `SELECT id, title, summary, duration_sec, source, created_at,
            kb_archived, kb_doc_title, meeting_id
     FROM meeting_records WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(userId, limit).all();
  return results || [];
}

export async function incrementTranslateUsage(db, { userId, walletAddress, charCount = 0 }) {
  const now = nowIso();
  const chars = Math.max(0, Number(charCount) || 0);
  await db.prepare(
    `INSERT INTO translate_usage (user_id, wallet_address, translate_count, char_count, last_used_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       translate_count = translate_count + 1,
       char_count = char_count + excluded.char_count,
       last_used_at = excluded.last_used_at,
       updated_at = excluded.updated_at`
  ).bind(userId, walletAddress, chars, now, now).run();
}

export async function getTranslateUsage(db, userId) {
  return db.prepare(
    'SELECT translate_count, char_count, last_used_at FROM translate_usage WHERE user_id = ?'
  ).bind(userId).first();
}

export async function logUsageEvent(db, { userId, walletAddress, action, units = 1, meta }) {
  await db.prepare(
    `INSERT INTO usage_events (user_id, wallet_address, action, units, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    userId || null,
    walletAddress || null,
    action,
    Math.max(1, Number(units) || 1),
    meta ? JSON.stringify(meta) : null,
    nowIso()
  ).run();
}

export async function listUsersAdmin(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, wallet_address, ens_name, auth_method, login_count,
            first_login_at, last_login_at, is_blocked, blocked_reason
     FROM users ORDER BY last_login_at DESC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

export async function setUserBlocked(db, walletAddress, blocked, reason = '') {
  const now = nowIso();
  await db.prepare(
    `UPDATE users SET is_blocked = ?, blocked_reason = ?, updated_at = ? WHERE wallet_address = ?`
  ).bind(blocked ? 1 : 0, reason || null, now, walletAddress).run();
}

export async function getUsageStats(db, days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { results: daily } = await db.prepare(
    `SELECT substr(created_at, 1, 10) AS day, action, SUM(units) AS total
     FROM usage_events WHERE created_at >= ?
     GROUP BY day, action ORDER BY day ASC`
  ).bind(since).all();

  const { results: totals } = await db.prepare(
    `SELECT action, SUM(units) AS total FROM usage_events WHERE created_at >= ? GROUP BY action`
  ).bind(since).all();

  const userCount = await db.prepare('SELECT COUNT(*) AS c FROM users').first();
  const blockedCount = await db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_blocked = 1').first();

  return {
    daily: daily || [],
    totals: totals || [],
    userCount: userCount?.c || 0,
    blockedCount: blockedCount?.c || 0,
    days,
  };
}

export async function getAdminDashboardStats(db, days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const base = await getUsageStats(db, days);

  let glmDaily = [];
  let glmTotals = [];
  let glmSuccess = { total: 0, success: 0, failed: 0, avgMs: 0 };
  let sourceBreakdown = [];
  let topWallets = [];
  let rateLimitEvents = [];
  let alerts = [];

  try {
    const { results: dailyGlm } = await db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total
       FROM glm_call_logs WHERE created_at >= ?
       GROUP BY day ORDER BY day ASC`
    ).bind(since).all();
    glmDaily = dailyGlm || [];

    const { results: totalsGlm } = await db.prepare(
      `SELECT source, COUNT(*) AS total,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
              AVG(duration_ms) AS avg_ms
       FROM glm_call_logs WHERE created_at >= ?
       GROUP BY source ORDER BY total DESC`
    ).bind(since).all();
    sourceBreakdown = totalsGlm || [];

    const summary = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
              AVG(duration_ms) AS avg_ms
       FROM glm_call_logs WHERE created_at >= ?`
    ).bind(since).first();
    glmSuccess = {
      total: summary?.total || 0,
      success: summary?.success_count || 0,
      failed: Math.max(0, (summary?.total || 0) - (summary?.success_count || 0)),
      avgMs: Math.round(summary?.avg_ms || 0),
    };

    const { results: wallets } = await db.prepare(
      `SELECT wallet_address, COUNT(*) AS total
       FROM glm_call_logs
       WHERE created_at >= ? AND wallet_address IS NOT NULL AND wallet_address != ''
       GROUP BY wallet_address ORDER BY total DESC LIMIT 10`
    ).bind(since).all();
    topWallets = wallets || [];

    const { results: limits } = await db.prepare(
      `SELECT id, identifier, identifier_type, reason, endpoint, created_at
       FROM rate_limit_events WHERE created_at >= ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(since).all();
    rateLimitEvents = limits || [];

    const { results: alertRows } = await db.prepare(
      `SELECT id, level, message, metric_value, threshold, acknowledged, created_at
       FROM platform_alerts WHERE acknowledged = 0
       ORDER BY created_at DESC LIMIT 10`
    ).all();
    alerts = alertRows || [];
  } catch (_) {
    /* glm_call_logs tables may not exist until schema-v2 migration */
  }

  return Object.assign(base, {
    glmDaily,
    glmSuccess,
    sourceBreakdown,
    topWallets,
    rateLimitEvents,
    alerts,
  });
}

export async function acknowledgePlatformAlert(db, alertId) {
  await db.prepare(
    'UPDATE platform_alerts SET acknowledged = 1 WHERE id = ?'
  ).bind(alertId).run();
}
