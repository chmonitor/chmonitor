/**
 * GitHub webhook signature verification (X-Hub-Signature-256).
 *
 * GitHub signs the raw request body with HMAC-SHA256 using the webhook's
 * configured secret and sends it as `sha256=<hex>`. This is the ONLY auth for
 * the inbound deploy webhook (routes/api/v1/webhooks/github.ts) — an
 * unsigned or mismatched payload MUST be rejected before anything in the body
 * is trusted. Mirrors the verify-then-act shape of the Polar/Clerk webhook
 * handlers, hand-rolled here because there is no GitHub webhook SDK in this
 * repo (unlike @polar-sh/sdk/webhooks or @clerk/.../webhooks).
 *
 * Uses the Web Crypto API (available in both the Cloudflare Workers runtime
 * and Bun, so this is directly unit-testable) and the shared constant-time
 * comparator so this security-critical primitive isn't reimplemented.
 */
import { constantTimeEqual } from '@/lib/auth/providers/constant-time'

const SIGNATURE_PREFIX = 'sha256='

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compute the `sha256=<hex>` value GitHub sends in X-Hub-Signature-256. */
export async function computeGithubSignature(
  secret: string,
  rawBody: string
): Promise<string> {
  return `${SIGNATURE_PREFIX}${await hmacSha256Hex(secret, rawBody)}`
}

/**
 * Verify a GitHub webhook's `X-Hub-Signature-256` header against the raw
 * request body, in constant time. Returns false for a missing header, a
 * header without the `sha256=` prefix, or a signature computed with a
 * different secret and/or over a different (tampered) body.
 */
export async function verifyGithubSignature(
  secret: string,
  rawBody: string,
  header: string | null | undefined
): Promise<boolean> {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false

  const expected = await computeGithubSignature(secret, rawBody)

  const encoder = new TextEncoder()
  return constantTimeEqual(encoder.encode(expected), encoder.encode(header))
}
