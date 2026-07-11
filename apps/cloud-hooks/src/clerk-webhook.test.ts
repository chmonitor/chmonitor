/**
 * Clerk webhook — Svix signature accept/reject, per-user sign-in throttle, and
 * event → notification wiring.
 *
 * The real `verifyClerkWebhook` is exercised with a genuinely computed HMAC so
 * the accept path proves the crypto, not a stub. Handler tests inject `verify`
 * to drive events without re-signing every fixture.
 */

import type { Env } from './env'
import type { NotifyKind } from './telegram'

import {
  type ClerkEvent,
  type ClerkKV,
  handleClerkWebhook,
  SIGNIN_THROTTLE_SECONDS,
  verifyClerkWebhook,
} from './clerk-webhook'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' // sample whsec_

async function sign(secret: string, id: string, ts: string, body: string) {
  const bytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) =>
    c.charCodeAt(0)
  )
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${body}`)
  )
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('verifyClerkWebhook — Svix signature', () => {
  const id = 'msg_1'
  const ts = '1700000000'
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } })

  test('accepts a correctly signed payload', async () => {
    const sig = await sign(SECRET, id, ts, body)
    const event = await verifyClerkWebhook(
      body,
      {
        'svix-id': id,
        'svix-timestamp': ts,
        'svix-signature': `v1,${sig}`,
      },
      SECRET
    )
    expect(event.type).toBe('user.created')
  })

  test('rejects a tampered body', async () => {
    const sig = await sign(SECRET, id, ts, body)
    await expect(
      verifyClerkWebhook(
        `${body} tampered`,
        { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
        SECRET
      )
    ).rejects.toThrow()
  })

  test('rejects when svix headers are missing', async () => {
    await expect(verifyClerkWebhook(body, {}, SECRET)).rejects.toThrow(/svix/i)
  })

  test('accepts when any one of multiple v1 signatures matches', async () => {
    const sig = await sign(SECRET, id, ts, body)
    const event = await verifyClerkWebhook(
      body,
      {
        'svix-id': id,
        'svix-timestamp': ts,
        'svix-signature': `v1,deadbeef v1,${sig}`,
      },
      SECRET
    )
    expect(event.type).toBe('user.created')
  })
})

// ── Handler tests (verify injected) ──────────────────────────────────────────

let notify: ReturnType<typeof mock>
const env: Env = { CLERK_WEBHOOK_SECRET: SECRET }

function req() {
  return new Request('https://hooks.chmonitor.dev/webhooks/clerk', {
    method: 'POST',
    body: '{}',
  })
}

function verifyReturning(event: ClerkEvent) {
  return () => event
}

beforeEach(() => {
  notify = mock(async () => true)
})

describe('handleClerkWebhook — config + signature gate', () => {
  test('501 when CLERK_WEBHOOK_SECRET is unset', async () => {
    const res = await handleClerkWebhook(
      req(),
      {},
      { notify: (k, t) => notify(k, t) }
    )
    expect(res.status).toBe(501)
    expect(notify).not.toHaveBeenCalled()
  })

  test('403 when verification throws SvixVerificationError', async () => {
    const res = await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: () => {
        throw Object.assign(new Error('bad'), { name: 'SvixVerificationError' })
      },
    })
    expect(res.status).toBe(403)
  })
})

describe('handleClerkWebhook — event → notification', () => {
  test('user.created → 🆕 new user notification with email/name', async () => {
    const res = await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: verifyReturning({
        type: 'user.created',
        data: {
          id: 'user_1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email_addresses: [{ email_address: 'ada@example.com' }],
        },
      }),
    })
    expect(res.status).toBe(202)
    expect(notify).toHaveBeenCalledTimes(1)
    const [kind, text] = notify.mock.calls[0] as [NotifyKind, string]
    expect(kind).toBe('user_created')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('ada@example.com')
  })

  test('organization.created → 🏢 new org notification', async () => {
    await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: verifyReturning({
        type: 'organization.created',
        data: { id: 'org_1', name: 'Acme' },
      }),
    })
    const [kind, text] = notify.mock.calls[0] as [NotifyKind, string]
    expect(kind).toBe('org_created')
    expect(text).toContain('Acme')
  })

  test('an unknown event type is acknowledged (202) with no notification', async () => {
    const res = await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: verifyReturning({ type: 'user.updated', data: {} }),
    })
    expect(res.status).toBe(202)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('handleClerkWebhook — sign-in throttle', () => {
  function memoryKv(): { kv: ClerkKV; store: Map<string, string> } {
    const store = new Map<string, string>()
    return {
      store,
      kv: {
        get: async (k) => store.get(k) ?? null,
        put: async (k, v) => {
          store.set(k, v)
        },
      },
    }
  }

  function signIn(userId = 'user_active') {
    return verifyReturning({
      type: 'session.created',
      data: { user_id: userId },
    })
  }

  test('first sign-in notifies and records the throttle key', async () => {
    const { kv, store } = memoryKv()
    await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: signIn(),
      kv,
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('session_created')
    expect(store.has('clerk-signin:v1:user_active')).toBe(true)
  })

  test('a second sign-in within the window is suppressed', async () => {
    const { kv } = memoryKv()
    const deps = {
      notify: (k: NotifyKind, t: string) => notify(k, t),
      verify: signIn(),
      kv,
    }
    await handleClerkWebhook(req(), env, deps)
    await handleClerkWebhook(req(), env, deps)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('different users each notify (per-user key)', async () => {
    const { kv } = memoryKv()
    await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: signIn('user_a'),
      kv,
    })
    await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: signIn('user_b'),
      kv,
    })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  test('no KV → sign-in always notifies (best-effort)', async () => {
    await handleClerkWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      verify: signIn(),
      kv: null,
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('the throttle window is 6 hours', () => {
    expect(SIGNIN_THROTTLE_SECONDS).toBe(6 * 60 * 60)
  })
})
