/**
 * Slack request signature verification (X-Slack-Signature).
 *
 * Slack signs every inbound request (slash commands, interactivity, events)
 * with HMAC-SHA256 over the string `v0:${timestamp}:${rawBody}` using the app's
 * signing secret, and sends the result as `X-Slack-Signature: v0=<hex>` plus the
 * `X-Slack-Request-Timestamp` header. This is the ONLY auth for those inbound
 * routes — an unsigned, mismatched, or stale request MUST be rejected before
 * anything in the body is trusted or acted upon.
 *
 * CRITICAL: the signature is computed over the RAW request body, so the caller
 * must read `await request.text()` and pass that exact string here BEFORE any
 * `request.formData()` / `request.json()` parse (which would consume the body).
 *
 * Two independent checks, both required:
 *  1. Timestamp freshness — reject if the request timestamp is more than
 *     {@link MAX_TIMESTAMP_SKEW_SECONDS} away from now (replay protection).
 *  2. Signature match — constant-time compare of the recomputed `v0=<hex>`
 *     against the header.
 *
 * Uses the Web Crypto API (available in the Cloudflare Workers runtime and Bun,
 * so this is directly unit-testable) and the shared constant-time comparator so
 * this security-critical primitive isn't reimplemented. Mirrors the shape of
 * lib/deployments/verify-signature.ts (GitHub) and the Polar/Clerk handlers.
 */
import { constantTimeEqual } from '@/lib/auth/providers/constant-time'

const SIGNATURE_VERSION = 'v0'
const SIGNATURE_PREFIX = `${SIGNATURE_VERSION}=`

/** Reject requests whose timestamp is more than 5 minutes from now. */
export const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5

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

/**
 * Compute the `v0=<hex>` signature Slack sends in `X-Slack-Signature` for a
 * given raw body + timestamp. Exported for tests (to forge a valid signature).
 */
export async function computeSlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string
): Promise<string> {
  const basestring = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`
  return `${SIGNATURE_PREFIX}${await hmacSha256Hex(signingSecret, basestring)}`
}

export interface VerifySlackRequestInput {
  /** The app signing secret (`SLACK_SIGNING_SECRET`). */
  signingSecret: string
  /** The `X-Slack-Signature` header value (`v0=<hex>`). */
  signature: string | null | undefined
  /** The `X-Slack-Request-Timestamp` header value (unix seconds, as string). */
  timestamp: string | null | undefined
  /** The exact raw request body the signature was computed over. */
  rawBody: string
  /** Injectable clock (unix seconds) for tests. Defaults to `Date.now()/1000`. */
  nowSeconds?: number
  /** Override the max allowed skew (seconds). Defaults to 5 minutes. */
  maxSkewSeconds?: number
}

/**
 * Verify a Slack inbound request. Returns `true` only when the timestamp is
 * fresh AND the signature matches (constant-time). Returns `false` for a
 * missing/blank header, a non-`v0=` prefix, a non-numeric or stale timestamp,
 * or a signature computed with a different secret and/or over a tampered body.
 * Never throws.
 */
export async function verifySlackRequest(
  input: VerifySlackRequestInput
): Promise<boolean> {
  const {
    signingSecret,
    signature,
    timestamp,
    rawBody,
    nowSeconds = Math.floor(Date.now() / 1000),
    maxSkewSeconds = MAX_TIMESTAMP_SKEW_SECONDS,
  } = input

  if (!signingSecret) return false
  if (!signature || !signature.startsWith(SIGNATURE_PREFIX)) return false
  if (!timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(nowSeconds - ts) > maxSkewSeconds) return false

  const expected = await computeSlackSignature(
    signingSecret,
    timestamp,
    rawBody
  )

  const encoder = new TextEncoder()
  return constantTimeEqual(encoder.encode(expected), encoder.encode(signature))
}
