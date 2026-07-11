/**
 * POST /webhooks/clerk — the cloud-hooks Clerk lifecycle receiver.
 *
 * Clerk signs its webhooks with **Svix** (headers `svix-id`, `svix-timestamp`,
 * `svix-signature`; secret `whsec_…`). The dashboard route verifies via Clerk's
 * bundled `verifyWebhook` (Svix under the hood); a tiny Worker doesn't want the
 * whole `@clerk/tanstack-react-start` bundle, so we do the SAME Svix HMAC-SHA256
 * check manually over WebCrypto — the wire scheme is identical, only the
 * transport dependency differs.
 *
 * Notifies the operator over Telegram on:
 *   user.created         → 🆕 new user (email / name)
 *   session.created      → 🔑 sign-in (email) — throttled per user via KV so an
 *                          active user can't spam the chat (1 per user / 6h)
 *   organization.created → 🏢 new organization
 * Every other event type is acknowledged (202) and ignored.
 *
 * Returns fast (202) and NEVER fails on a Telegram error. 501 when the signing
 * secret is unset; 403 on a bad signature.
 *
 * Unauthenticated by design — the Svix signature IS the auth.
 */

import type { Env } from './env'
import type { NotifyKind } from './telegram'

/** Thrown by `verifyClerkWebhook` on any signature/header failure. */
export class SvixVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SvixVerificationError'
  }
}

/** Minimal KV subset for the sign-in throttle (mirrors probes' KVLike). */
export interface ClerkKV {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>
}

/** Injected so handler tests can drive events without a real signature. */
export type VerifyClerkFn = (
  body: string,
  headers: Record<string, string>,
  secret: string
) => Promise<ClerkEvent> | ClerkEvent

export interface ClerkEvent {
  type: string
  data: Record<string, unknown>
}

export interface ClerkWebhookDeps {
  notify: (kind: NotifyKind, text: string) => Promise<boolean>
  /** Defaults to the real Svix HMAC verification. */
  verify?: VerifyClerkFn
  kv?: ClerkKV | null
  now?: () => number
}

/** Sign-in notifications: at most one per user within this window. */
export const SIGNIN_THROTTLE_SECONDS = 6 * 60 * 60

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Constant-time-ish string compare (avoids early-exit length leak). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Verify a Clerk (Svix) webhook and return the parsed event. Throws
 * `SvixVerificationError` on any missing header or signature mismatch. The
 * signed content is `${svix-id}.${svix-timestamp}.${body}`, HMAC-SHA256 with the
 * base64-decoded secret (the part after `whsec_`), matched against any `v1,<sig>`
 * entry in the space-delimited `svix-signature` header.
 */
export async function verifyClerkWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string
): Promise<ClerkEvent> {
  const id = headers['svix-id']
  const timestamp = headers['svix-timestamp']
  const signature = headers['svix-signature']
  if (!id || !timestamp || !signature) {
    throw new SvixVerificationError('missing svix-* headers')
  }

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const signedContent = `${id}.${timestamp}.${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedContent)
  )
  const expected = bytesToBase64(new Uint8Array(sigBuf))

  const passed = signature.split(' ').some((part) => {
    const comma = part.indexOf(',')
    if (comma === -1) return false
    const version = part.slice(0, comma)
    const value = part.slice(comma + 1)
    return version === 'v1' && safeEqual(value, expected)
  })
  if (!passed) throw new SvixVerificationError('no matching v1 signature')

  return JSON.parse(body) as ClerkEvent
}

// ── Event field extractors (tolerant of Clerk's snake_case payloads) ──────────

function emailOf(data: Record<string, unknown>): string | undefined {
  const list = data.email_addresses as
    | Array<{ email_address?: string }>
    | undefined
  return list?.[0]?.email_address ?? undefined
}

function nameOf(data: Record<string, unknown>): string | undefined {
  const first = typeof data.first_name === 'string' ? data.first_name : ''
  const last = typeof data.last_name === 'string' ? data.last_name : ''
  const full = `${first} ${last}`.trim()
  return full || undefined
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function handleClerkWebhook(
  request: Request,
  env: Env,
  deps: ClerkWebhookDeps
): Promise<Response> {
  const secret = env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    return Response.json(
      { error: 'Clerk webhook not configured' },
      { status: 501 }
    )
  }

  const body = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  let event: ClerkEvent
  try {
    const verify = deps.verify ?? verifyClerkWebhook
    event = await verify(body, headers, secret)
  } catch (err) {
    if ((err as Error)?.name === 'SvixVerificationError') {
      return Response.json({ error: 'Invalid signature' }, { status: 403 })
    }
    console.error('[cloud-hooks] failed to parse Clerk event', err)
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  // Notifications are best-effort — never let one fail the 202 ack.
  try {
    await notifyClerkEvent(event, deps)
  } catch (err) {
    console.error('[cloud-hooks] clerk notify error', err)
  }

  return Response.json({ received: true }, { status: 202 })
}

async function notifyClerkEvent(
  event: ClerkEvent,
  deps: ClerkWebhookDeps
): Promise<void> {
  const { data } = event
  switch (event.type) {
    case 'user.created': {
      const email = emailOf(data)
      const name = nameOf(data)
      const who = [name, email]
        .filter((v): v is string => Boolean(v))
        .map(escapeHtml)
        .join(' · ')
      await deps.notify(
        'user_created',
        `\u{1F195} <b>New user</b>\n${who || '(no email/name)'}`
      )
      return
    }
    case 'session.created': {
      const userId = typeof data.user_id === 'string' ? data.user_id : undefined
      if (userId && !(await allowSignInNotify(userId, deps))) return
      await deps.notify(
        'session_created',
        `\u{1F511} <b>Sign-in</b>\n<code>${escapeHtml(userId ?? '(unknown user)')}</code>`
      )
      return
    }
    case 'organization.created': {
      const orgName = typeof data.name === 'string' ? data.name : undefined
      const orgId = typeof data.id === 'string' ? data.id : undefined
      await deps.notify(
        'org_created',
        `\u{1F3E2} <b>New organization</b>\n${escapeHtml(orgName ?? orgId ?? '(unnamed)')}`
      )
      return
    }
    default:
      // Unknown events are acknowledged (202) and ignored.
      return
  }
}

/**
 * Per-user sign-in throttle via KV. Returns true when a notification is allowed
 * (and records the send). No KV → always allowed (best-effort, like probes).
 */
async function allowSignInNotify(
  userId: string,
  deps: ClerkWebhookDeps
): Promise<boolean> {
  const kv = deps.kv
  if (!kv) return true
  const key = `clerk-signin:v1:${userId}`
  try {
    const seen = await kv.get(key)
    if (seen) return false
    const now = deps.now ? deps.now() : Date.now()
    await kv.put(key, String(now), { expirationTtl: SIGNIN_THROTTLE_SECONDS })
    return true
  } catch (err) {
    // KV hiccup must not swallow the notification.
    console.error('[cloud-hooks] sign-in throttle KV error', err)
    return true
  }
}
