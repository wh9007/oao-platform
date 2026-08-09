const enc = new TextEncoder();

function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : enc.encode(String(input));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(payload, secret, ttlSec = 86400 * 7) {
  if (!secret) throw new Error('jwt_secret_missing');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const bodyObj = { ...payload, iat: now, exp: now + ttlSec };
  const body = b64url(JSON.stringify(bodyObj));
  const data = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sigBytes = b64urlDecode(sig);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
  if (!ok) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!json.exp || json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch (_) {
    return null;
  }
}

export function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}
