(function (global) {
  'use strict';

  const TOKEN_KEY = 'oao_platform_token';
  const USER_KEY = 'oao_platform_user';

  function resolveWorkerBaseUrl() {
    if (global.OAO_WORKER_URL) return String(global.OAO_WORKER_URL).replace(/\/$/, '');
    if (global.OAO_AI_BASE_URL) return String(global.OAO_AI_BASE_URL).replace(/\/$/, '');
    return 'https://oao-ai.wh529007.workers.dev';
  }

  function getLang() {
    try {
      return localStorage.getItem('oao-language') === 'en' ? 'en' : 'zh';
    } catch (_) {
      return 'zh';
    }
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }

  function readWalletSession() {
    try {
      const raw = localStorage.getItem('oao_wallet_session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function readWeChatSession() {
    try {
      const raw = localStorage.getItem('oao_wechat_session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function detectLocalAuth() {
    if (typeof global.isOAOAuthenticated === 'function' && global.isOAOAuthenticated()) {
      const userId = typeof global.getOAOUserId === 'function' ? global.getOAOUserId() : '';
      if (userId && userId !== 'admin_test') {
        return {
          type: global.isOAOWalletVerified?.() ? 'wallet' : 'wechat',
          userId: userId.toLowerCase(),
        };
      }
    }
    const wallet = readWalletSession();
    if (wallet?.address && wallet.message && wallet.signature) {
      return { type: 'wallet', userId: wallet.address.toLowerCase(), wallet };
    }
    const wechat = readWeChatSession();
    if (wechat?.openid) {
      return { type: 'wechat', userId: ('wechat_' + wechat.openid).toLowerCase(), wechat };
    }
    return null;
  }

  function buildSyncBody(auth) {
    auth = auth || detectLocalAuth();
    if (!auth) return null;
    const body = {
      userId: auth.userId,
      address: auth.userId,
      authMethod: auth.type,
      ensName: document.getElementById('userAddress')?.dataset?.ens || '',
    };
    if (auth.type === 'wallet') {
      const session = auth.wallet || readWalletSession();
      if (session?.address && session.message && session.signature) {
        body.address = session.address;
        body.message = session.message;
        body.signature = session.signature;
      }
    }
    return body;
  }

  function setSession(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (_) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function authHeaders() {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  async function apiFetch(path, options) {
    options = options || {};
    const url = resolveWorkerBaseUrl() + path;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign({}, authHeaders(), options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function buildGlmMeta(action) {
    if (typeof global.getOAOUserId !== 'function') return undefined;
    const userId = global.getOAOUserId();
    if (!userId || userId === 'admin_test') return undefined;
    return { userId: userId.toLowerCase(), action: action || 'glm_chat' };
  }

  async function syncUser(options) {
    options = options || {};
    const body = buildSyncBody();
    if (!body) return null;
    try {
      const data = await apiFetch('/api/user/sync', { method: 'POST', body });
      if (data?.token) setSession(data.token, data.user);
      return data;
    } catch (error) {
      if (!options.silent) console.warn('[OAO Platform] syncUser failed:', error);
      return null;
    }
  }

  async function syncUserFromStorage(options) {
    return syncUser(options);
  }

  async function ensurePlatformSession(options) {
    options = options || {};
    if (getToken()) return { ok: true, token: getToken() };
    const auth = detectLocalAuth();
    if (!auth) return { ok: false, reason: 'not_logged_in' };
    const data = await syncUserFromStorage(options);
    if (data?.token) return { ok: true, token: data.token, user: data.user };
    return { ok: false, reason: 'sync_failed' };
  }

  async function saveMeetingRecord(payload) {
    if (!getToken()) return null;
    try {
      return await apiFetch('/api/user/meetings', {
        method: 'POST',
        body: payload,
      });
    } catch (error) {
      console.warn('[OAO Platform] saveMeetingRecord failed:', error);
      return null;
    }
  }

  async function recordTranslate(charCount) {
    if (!getToken()) return null;
    try {
      return await apiFetch('/api/user/translate', {
        method: 'POST',
        body: { charCount: Math.max(0, charCount || 0) },
      });
    } catch (error) {
      console.warn('[OAO Platform] recordTranslate failed:', error);
      return null;
    }
  }

  async function fetchProfile() {
    return apiFetch('/api/user/me');
  }

  async function fetchMeetings() {
    return apiFetch('/api/user/meetings');
  }

  function isBlockedError(error) {
    return error?.status === 403 && error?.data?.error === 'user_blocked';
  }

  function blockedMessage(error) {
    const lang = getLang();
    if (lang === 'en') return error?.data?.message_en || error?.data?.message || 'Account restricted';
    return error?.data?.message || '账号已被限制';
  }

  global.OAOPlatform = {
    resolveWorkerBaseUrl,
    getToken,
    setSession,
    clearSession,
    authHeaders,
    detectLocalAuth,
    syncUser,
    syncUserFromStorage,
    ensurePlatformSession,
    saveMeetingRecord,
    recordTranslate,
    fetchProfile,
    fetchMeetings,
    buildGlmMeta,
    isBlockedError,
    blockedMessage,
  };
})(typeof window !== 'undefined' ? window : global);
