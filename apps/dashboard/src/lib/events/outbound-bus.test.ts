/**
 * Core bus tests (plan 44): fan-out + HMAC signature + bounded retry/backoff
 * + SSRF guard. `outbound-bus.ts` statically imports `subscription-store.ts`,
 * which imports `getPlatformBindings` from `@chm/platform` — resolving (via
 * the tsconfig alias) to `platform-native.ts`'s
 * `import { env } from 'cloudflare:workers'`, a virtual module `bun test`
 * doesn't provide. Mock it before importing, mirroring
 * `conversation-store/d1-store.sql.test.ts`'s established pattern. Every test
 * here injects its own `recordDelivery`/`listSubscriptionsForEvent` deps, so
 * the mocked D1 binding itself is never actually touched.
 */

import type { WebhookSubscription } from './subscription-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHmac } from 'node:crypto'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => undefined,
  }),
}))

const { deliver, emitEvent, signPayload } = await import('./outbound-bus')
const { EMITTABLE_EVENT_TYPES } = await import('./event-types')

function makeSubscription(
  overrides: Partial<WebhookSubscription> = {}
): WebhookSubscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    url: 'https://example.com/hook',
    secret: 'test-secret',
    eventTypes: ['connection.created'],
    enabled: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function makeEvent(
  overrides: Partial<import('./event-types').EventPayload> = {}
): import('./event-types').EventPayload {
  return {
    id: 'evt-1',
    type: 'connection.created',
    occurred_at: new Date(1_700_000_001_000).toISOString(),
    data: { id: 'conn-1', name: 'prod' },
    ...overrides,
  }
}

/** Independent HMAC verification: node:crypto, NOT the crypto.subtle path signPayload uses. */
function independentHmacHex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

const noDelay = async () => {}

/**
 * Fake DNS resolver returning a public, non-internal address (TEST-NET-3,
 * RFC 5737 — reserved for documentation, guaranteed never RFC1918/loopback/
 * link-local/CGNAT). Every test that expects delivery to proceed injects this
 * instead of relying on `validateHostUrl`'s real `node:dns` lookup — a
 * sandbox with no outbound DNS (or a placeholder host like `b.example.com`
 * that doesn't actually resolve) would otherwise make the guard fail closed
 * and turn a "delivery succeeds" test into an indistinguishable "SSRF
 * blocked" one.
 */
const publicResolver = async () => ['203.0.113.10']

describe('signPayload', () => {
  test('computes HMAC-SHA256 over the exact raw body, matching an independent verify', async () => {
    const body = JSON.stringify(makeEvent())
    const secret = 'super-secret-value'

    const sig = await signPayload(secret, body)
    const expected = independentHmacHex(secret, body)

    expect(sig).toBe(expected)
    // A single-byte change anywhere in the body must change the signature.
    expect(await signPayload(secret, `${body} `)).not.toBe(sig)
  })
})

describe('deliver', () => {
  let recorded: Array<Record<string, unknown>>

  beforeEach(() => {
    recorded = []
  })

  async function recordDelivery(record: Record<string, unknown>) {
    recorded.push(record)
  }

  test('sends a valid HMAC signature + timestamp/delivery headers and records "delivered"', async () => {
    const sub = makeSubscription()
    const evt = makeEvent()
    let capturedRequest: { url: string; init: RequestInit } | undefined

    const fetchImpl = mock(async (url: string, init: RequestInit) => {
      capturedRequest = { url: url.toString(), init }
      return new Response(null, { status: 200 })
    })

    const outcome = await deliver(sub, evt, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    // The return value (not just the recorded audit row) is what the "send
    // test" route reports back to the user immediately — see
    // `routes/api/v1/webhooks/subscriptions/$id/test.ts`.
    expect(outcome).toMatchObject({
      status: 'delivered',
      attempts: 1,
      lastStatusCode: 200,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(capturedRequest?.url).toBe(sub.url)
    const headers = capturedRequest?.init.headers as Record<string, string>
    expect(headers['X-Chmonitor-Event']).toBe('connection.created')
    expect(headers['X-Chmonitor-Delivery']).toBe(evt.id)
    expect(headers['X-Chmonitor-Timestamp']).toMatch(/^\d+$/)

    const expectedSig = independentHmacHex(
      sub.secret,
      capturedRequest?.init.body as string
    )
    expect(headers['X-Chmonitor-Signature']).toBe(`sha256=${expectedSig}`)
    // Exact raw body, not a re-serialization — proves the signature covers
    // precisely what was sent.
    expect(capturedRequest?.init.body).toBe(JSON.stringify(evt))

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ status: 'delivered', attempts: 1 })
  })

  test('SSRF guard rejects a private/link-local subscription URL — no fetch attempted', async () => {
    const sub = makeSubscription({ url: 'http://169.254.169.254/metadata' })
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: async () => ['169.254.169.254'],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.status).toBe('dead')
    expect(recorded[0]?.attempts).toBe(0)
    expect(recorded[0]?.lastError).toBeTruthy()
  })

  test('retries a 500 then succeeds on the 2nd attempt — bounded, recorded attempts=2', async () => {
    const sub = makeSubscription()
    let calls = 0
    const fetchImpl = mock(async () => {
      calls += 1
      return calls === 1
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 200 })
    })
    const delaySpy = mock(async (_ms: number) => {})

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: delaySpy,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // Backoff: 0 before attempt 1, 2000ms before attempt 2 (bounded schedule).
    expect(delaySpy.mock.calls.map((c) => c[0])).toEqual([0, 2000])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ status: 'delivered', attempts: 2 })
  })

  test('a persistent 500 is bounded to 3 attempts and lands in the dead-letter log', async () => {
    const sub = makeSubscription()
    const fetchImpl = mock(async () => new Response(null, { status: 500 }))

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    // Bounded: exactly 3 attempts, never more, regardless of continued failure.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      status: 'dead',
      attempts: 3,
      lastStatusCode: 500,
    })
  })

  test('a non-retryable 4xx (not 429) stops immediately without exhausting retries', async () => {
    const sub = makeSubscription()
    const fetchImpl = mock(async () => new Response(null, { status: 404 }))

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(recorded[0]).toMatchObject({
      status: 'dead',
      attempts: 1,
      lastStatusCode: 404,
    })
  })

  test('429 is retried like a 5xx (rate limit is transient)', async () => {
    const sub = makeSubscription()
    let calls = 0
    const fetchImpl = mock(async () => {
      calls += 1
      return calls === 1
        ? new Response(null, { status: 429 })
        : new Response(null, { status: 200 })
    })

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(recorded[0]).toMatchObject({ status: 'delivered', attempts: 2 })
  })

  test('a network error (fetch throws) is retried and bounded like a 5xx', async () => {
    const sub = makeSubscription()
    const fetchImpl = mock(async () => {
      throw new Error('connection reset')
    })

    await deliver(sub, makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery,
      resolveHostAddresses: publicResolver,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(recorded[0]).toMatchObject({ status: 'dead', attempts: 3 })
    expect(recorded[0]?.lastError).toContain('connection reset')
  })

  test('deliver() never throws even when recordDelivery itself fails', async () => {
    const sub = makeSubscription()
    const fetchImpl = mock(async () => new Response(null, { status: 500 }))

    // Resolves with SOME outcome rather than rejecting — the exact shape
    // doesn't matter here, only that a store failure can't propagate.
    await expect(
      deliver(sub, makeEvent(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        delay: noDelay,
        recordDelivery: async () => {
          throw new Error('D1 write failed')
        },
        resolveHostAddresses: publicResolver,
      })
    ).resolves.toBeTruthy()
  })
})

describe('emitEvent', () => {
  test('fans an event out to every enabled subscription owned by the user for that type', async () => {
    const subs = [
      makeSubscription({ id: 'sub-a', secret: 'secret-a' }),
      makeSubscription({
        id: 'sub-b',
        secret: 'secret-b',
        url: 'https://b.example.com/hook',
      }),
    ]
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const recorded: Array<Record<string, unknown>> = []

    await emitEvent('user-1', makeEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: noDelay,
      recordDelivery: async (r) => {
        recorded.push(r)
      },
      resolveHostAddresses: publicResolver,
      listSubscriptionsForEvent: async (userId, eventType) => {
        expect(userId).toBe('user-1')
        expect(eventType).toBe('connection.created')
        return subs
      },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(recorded).toHaveLength(2)
    expect(recorded.map((r) => r.subscriptionId).sort()).toEqual([
      'sub-a',
      'sub-b',
    ])
  })

  test('never throws when the subscription lookup itself fails (producer isolation)', async () => {
    await expect(
      emitEvent('user-1', makeEvent(), {
        listSubscriptionsForEvent: async () => {
          throw new Error('D1 unavailable')
        },
      })
    ).resolves.toBeUndefined()
  })

  test('never throws when every delivery fails', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('boom')
    })

    await expect(
      emitEvent('user-1', makeEvent(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        delay: noDelay,
        recordDelivery: async () => {},
        resolveHostAddresses: publicResolver,
        listSubscriptionsForEvent: async () => [makeSubscription()],
      })
    ).resolves.toBeUndefined()
  })

  test('is a no-op (no lookup side effects needed) when there are no matching subscriptions', async () => {
    const recordDelivery = mock(async () => {})
    await emitEvent('user-1', makeEvent(), {
      recordDelivery,
      listSubscriptionsForEvent: async () => [],
    })
    expect(recordDelivery).not.toHaveBeenCalled()
  })
})

describe('event taxonomy', () => {
  test('only lists event types with a genuine wired producer', () => {
    // See event-types.ts docblock: alert.*/insight.* have no per-user owner
    // anywhere in this codebase today, so they are intentionally absent.
    expect(EMITTABLE_EVENT_TYPES).toEqual([
      'connection.created',
      'connection.deleted',
    ])
  })
})
