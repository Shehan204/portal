import crypto from 'crypto';

export function generateSecureNonce(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateSessionId(): string {
  return 'SES-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function generateSessionSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes HMAC-SHA256 signature and returns truncated hex string
 */
export function computeFrameSignature(data: string, secret: string, length = 16): string {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
    .slice(0, length);
}

/**
 * Computes SHA-256 hash for frame chaining
 */
export function computeChainHash(prevHash: string, seq: number, ts: number, nonce: string, length = 8): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}:${seq}:${ts}:${nonce}`)
    .digest('hex')
    .slice(0, length);
}

/**
 * Timing-safe comparison to prevent timing attacks on HMAC validation
 */
export function verifySignatureTimingSafe(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided, 'utf-8'), Buffer.from(expected, 'utf-8'));
}
