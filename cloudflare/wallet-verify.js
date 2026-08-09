import { verifyMessage } from 'viem';

export async function verifyWalletLogin({ address, message, signature }) {
  if (!address || !message || !signature) return false;
  try {
    const valid = await verifyMessage({
      address,
      message,
      signature,
    });
    return !!valid;
  } catch (_) {
    return false;
  }
}

export function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

export function isWalletAddress(address) {
  return /^0x[a-f0-9]{40}$/i.test(String(address || '').trim());
}
