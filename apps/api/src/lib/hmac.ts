import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 over the canonical request:
 *   `${method}\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`
 *
 * Caller signs with appSecret. Server reproduces and timing-safe compares.
 *
 * Headers (case-insensitive):
 *   X-Abd-Key:       app_key (UUID-ish public id)
 *   X-Abd-Timestamp: unix seconds, must be within ±300s
 *   X-Abd-Nonce:     unique per request (no replay tracking yet — TODO)
 *   X-Abd-Signature: hex(HMAC-SHA256(canonical))
 */

export function canonicalRequest(args: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyBytes: Buffer;
}): string {
  const bodyHash = createHmac('sha256', '__abd_body_hash__')
    .update(args.bodyBytes)
    .digest('hex');
  return [
    args.method.toUpperCase(),
    args.path,
    args.timestamp,
    args.nonce,
    bodyHash,
  ].join('\n');
}

export function signRequest(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifySignature(secret: string, canonical: string, given: string): boolean {
  const expected = signRequest(secret, canonical);
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
  } catch {
    return false;
  }
}

/** Generate a Webhook delivery signature header (same algorithm). */
export function signWebhookBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
