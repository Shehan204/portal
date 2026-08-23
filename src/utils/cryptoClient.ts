import {
  ActiveSession,
  AttendanceRecord,
  ExperimentMode,
  OpticalFramePayload,
  ResearchMetric,
  SessionConfig,
  StudentSubmission,
} from '../types/protocol';

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
 * Simple fast pure-JS SHA-256 implementation for synchronous client-side optical frame generation & verification
 */
function sha256Sync(ascii: string): string {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i = 0, j = 0;
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0x0bef9a3f, 0xc67178f2,
  ];

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 =
        ((w15 >>> 7) | (w15 << 25)) ^
        ((w15 >>> 18) | (w15 << 14)) ^
        (w15 >>> 3);
      const s1 =
        ((w2 >>> 17) | (w2 << 15)) ^
        ((w2 >>> 19) | (w2 << 13)) ^
        (w2 >>> 10);

      w[i] =
        i < 16
          ? w[i]
          : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s1_maj =
        ((hash[0] >>> 2) | (hash[0] << 30)) ^
        ((hash[0] >>> 13) | (hash[0] << 19)) ^
        ((hash[0] >>> 22) | (hash[0] << 10));
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const t2 = (s1_maj + maj) | 0;

      const s0_ch =
        ((hash[4] >>> 6) | (hash[4] << 26)) ^
        ((hash[4] >>> 11) | (hash[4] << 21)) ^
        ((hash[4] >>> 25) | (hash[4] << 7));
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const t1 = (hash[7] + s0_ch + ch + k[i] + w[i]) | 0;

      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
      hash.pop();
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function computeClientChainHash(prevHash: string, seq: number, ts: number, nonce: string, length = 8): string {
  const raw = `${prevHash}:${seq}:${ts}:${nonce}`;
  return sha256Sync(raw).slice(0, length);
}

export function computeClientFrameSignature(data: string, secret: string, length = 16): string {
  // Simple synchronous HMAC emulation using double SHA-256 for browser offline fallback
  const inner = sha256Sync(`${secret}:${data}`);
  return sha256Sync(`${secret}:${inner}`).slice(0, length);
}

export function serializeClientFramePayload(payload: OpticalFramePayload): string {
  const modeCodeMap: Record<string, string> = {
    MODE_A_STATIC: 'A',
    MODE_B_DYNAMIC: 'B',
    MODE_C_AUTHENTICATED: 'C',
    MODE_D_AUTH_RANDOM_TIMING: 'D',
  };

  const modeCode = modeCodeMap[payload.mode] || 'C';
  const parts = [
    `V${payload.v}`,
    payload.sid,
    payload.seq.toString(),
    payload.ts.toString(),
    payload.dur.toString(),
    modeCode,
    payload.prevHash || '',
    payload.sig || '',
  ];

  return parts.join('~');
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

/**
 * Generate Next Optical Frame on client (Offline / Static fallback mode)
 */
export function createClientOpticalFrame(
  sessionId: string,
  sessionNonce: string,
  sessionSecret: string,
  seq: number,
  config: SessionConfig,
  prevChainHash: string,
  overrideTs?: number,
  overrideDur?: number
): { payload: OpticalFramePayload; raw: string; chainHash: string } {
  const ts = overrideTs !== undefined ? overrideTs : Date.now();
  let dur = Math.round(1000 / config.qrRate);

  if (config.randomTiming && config.mode === 'MODE_D_AUTH_RANDOM_TIMING') {
    const jitterFactor = (config.timingJitterPercent || 20) / 100;
    const delta = dur * jitterFactor;
    const randomShift = (Math.random() * 2 - 1) * delta;
    dur = Math.max(30, Math.round(dur + randomShift));
  }
  if (overrideDur !== undefined) {
    dur = overrideDur;
  }

  const chainHash = config.frameChaining
    ? computeClientChainHash(prevChainHash, seq, ts, sessionNonce)
    : '';

  const frameSeq = config.mode === 'MODE_A_STATIC' ? 1 : seq;
  const frameTs = config.mode === 'MODE_A_STATIC' ? 0 : ts;

  const payloadDataToSign = `${sessionId}:${frameSeq}:${frameTs}:${dur}:${chainHash}:${sessionNonce}`;

  let sig: string | undefined = undefined;
  if (config.mode === 'MODE_C_AUTHENTICATED' || config.mode === 'MODE_D_AUTH_RANDOM_TIMING') {
    sig = computeClientFrameSignature(payloadDataToSign, sessionSecret);
  }

  const payload: OpticalFramePayload = {
    v: 1,
    sid: sessionId,
    seq: frameSeq,
    ts: frameTs,
    dur,
    mode: config.mode,
    prevHash: config.frameChaining ? prevChainHash : undefined,
    sig,
  };

  const raw = serializeClientFramePayload(payload);
  return { payload, raw, chainHash };
}
