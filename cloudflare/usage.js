import { isUserBlocked, logUsageEvent, getUserByAddress } from './db.js';

export const BLOCKED_MESSAGE = {
  zh: '您的账号已被限制使用 OAO 云端服务，如有疑问请联系管理员。',
  en: 'Your account has been restricted from OAO cloud services. Please contact the administrator.',
};

export async function checkBlockedUser(db, walletAddress) {
  if (!walletAddress || !db) return null;
  const blocked = await isUserBlocked(db, walletAddress);
  if (!blocked) return null;
  const user = await getUserByAddress(db, walletAddress);
  return {
    error: 'user_blocked',
    message: BLOCKED_MESSAGE.zh,
    message_en: BLOCKED_MESSAGE.en,
    reason: user?.blocked_reason || '',
  };
}

export async function recordGlmUsage(db, meta, inputChars = 0, outputChars = 0) {
  if (!db || !meta?.userId) return;
  const units = Math.max(1, Math.ceil((inputChars + outputChars) / 500));
  const user = await getUserByAddress(db, meta.userId);
  await logUsageEvent(db, {
    userId: user?.id || null,
    walletAddress: meta.userId,
    action: meta.action || 'glm_chat',
    units,
    meta: { inputChars, outputChars, model: meta.model },
  });
}

export function extractOaoMeta(body) {
  if (!body || typeof body !== 'object') return { meta: null, cleanBody: body };
  const meta = body._oaoMeta || null;
  const cleanBody = { ...body };
  delete cleanBody._oaoMeta;
  return { meta, cleanBody };
}

export function estimateMessageChars(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, m) => sum + String(m?.content || '').length, 0);
}
