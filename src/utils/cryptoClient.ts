import { OpticalFramePayload } from '../types/protocol';

/**
 * Generate client-side random challenge
 */
export function generateClientChallenge(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return 'CHAL-' + Math.random().toString(36).substring(2, 10);
}

/**
 * Parse compact payload string on client
 */
export function parseClientFramePayload(raw: string): OpticalFramePayload | null {
  try {
    if (raw.startsWith('{')) {
      return JSON.parse(raw) as OpticalFramePayload;
    }

    const parts = raw.split('~');
    if (parts.length < 6) return null;

    const codeToModeMap: Record<string, any> = {
      A: 'MODE_A_STATIC',
      B: 'MODE_B_DYNAMIC',
      C: 'MODE_C_AUTHENTICATED',
      D: 'MODE_D_AUTH_RANDOM_TIMING',
    };

    const v = parseInt(parts[0].replace('V', ''), 10) || 1;
    const sid = parts[1];
    const seq = parseInt(parts[2], 10);
    const ts = parseInt(parts[3], 10);
    const dur = parseInt(parts[4], 10);
    const mode = codeToModeMap[parts[5]] || 'MODE_C_AUTHENTICATED';
    const prevHash = parts[6] || undefined;
    const sig = parts[7] || undefined;

    return {
      v,
      sid,
      seq,
      ts,
      dur,
      mode,
      prevHash,
      sig,
    };
  } catch {
    return null;
  }
}
