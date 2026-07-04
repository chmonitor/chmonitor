/**
 * Stateless CSRF `state` for the Slack OAuth install flow (plans/37).
 *
 * Slack's OAuth redirect (`/api/v1/slack/oauth`) is a browser GET that Slack
 * does NOT sign — so the `state` parameter is the CSRF defense. This app has no
 * guaranteed server session store on Workers (and OSS must work without one), so
 * `state` is a self-contained, HMAC-signed token instead of a stored nonce:
 *
 *   state = base64url(JSON payload) + '.' + hex(HMAC-SHA256(secret, payload))
 *
 * The callback recomputes the HMAC (constant-time compare) and rejects a
 * tampered/forged token, and enforces a short freshness window so a leaked
 * state can't be replayed indefinitely. The payload also carries `ownerRef` so
 * the install is bound to whoever started it (a Clerk user in cloud mode, or
 * 'default' for single-tenant OSS) without a server round-trip.
 *
 * Signed with the Slack signing secret (passed in, so this stays a pure,
 * testable leaf with no env import).
 */

import { constantTimeEqual } from '@/lib/auth/providers/constant-time'

/** Default freshness window for an install `state`: 10 minutes. */
export const STATE_MAX_AGE_SECONDS = 60 * 10

interface StatePayload {
  /** Random nonce (defense in depth against fixed-token reuse). */
  n: string
  /** Issued-at, unix ms. */
  t: number
  /** chmonitor owner ref bound to this install. */
  o: string
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function hmacHex(secret: string, message: string): Promise<string> {
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

/** Issue a signed `state` binding this install to `ownerRef`. */
export async function signOAuthState(
  secret: string,
  ownerRef: string,
  nowMs: number = Date.now()
): Promise<string> {
  const payload: StatePayload = {
    n: crypto.randomUUID(),
    t: nowMs,
    o: ownerRef,
  }
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacHex(secret, encoded)
  return `${encoded}.${sig}`
}

/**
 * Verify a `state` token: signature must match (constant-time) and it must be
 * within the freshness window. Returns the bound `ownerRef` on success, or null
 * on any tamper / stale / malformed input. Never throws.
 */
export async function verifyOAuthState(
  secret: string,
  state: string | null | undefined,
  opts: { nowMs?: number; maxAgeSeconds?: number } = {}
): Promise<{ ownerRef: string } | null> {
  if (!secret || !state) return null
  const dot = state.lastIndexOf('.')
  if (dot <= 0) return null

  const encoded = state.slice(0, dot)
  const providedSig = state.slice(dot + 1)

  const expectedSig = await hmacHex(secret, encoded)
  const enc = new TextEncoder()
  if (!constantTimeEqual(enc.encode(expectedSig), enc.encode(providedSig))) {
    return null
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(encoded))
    ) as StatePayload
  } catch {
    return null
  }

  const nowMs = opts.nowMs ?? Date.now()
  const maxAgeSeconds = opts.maxAgeSeconds ?? STATE_MAX_AGE_SECONDS
  if (
    typeof payload.t !== 'number' ||
    !Number.isFinite(payload.t) ||
    Math.abs(nowMs - payload.t) > maxAgeSeconds * 1000
  ) {
    return null
  }
  if (typeof payload.o !== 'string' || payload.o.length === 0) return null

  return { ownerRef: payload.o }
}
