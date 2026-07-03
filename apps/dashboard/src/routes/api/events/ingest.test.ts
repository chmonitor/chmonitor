/**
 * Unit tests for POST /api/events/ingest.
 *
 * REAL TEST: this is the fail-open behavior the plan requires — events
 * enqueue (202) when a Cloudflare Queue binding is present, and the no-binding
 * path degrades to synchronous inline processing (200) without ever throwing
 * or 500ing, which is the everyday state on self-host and on cloud before the
 * queue is provisioned (see wrangler.toml's external-setup note). Also covers
 * the auth gate (fail-closed when CHM_EVENTS_INGEST_TOKEN is unset — mirrors
 * CRON_SECRET in api/cron/retention-prune.ts) and basic body validation.
 *
 * `@chm/platform` is mocked to keep D1 fully in-memory / unbound (no Workers
 * runtime needed) — same pattern as ai-usage-store.test.ts /
 * retention-prune.test.ts. The queue-present/absent branch is driven via the
 * route's `deps.getQueue` injection seam so each test controls it directly,
 * independent of the platform mock.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { _resetBucketsForTest } from '@/lib/api/rate-limiter'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => null,
    getQueue: () => null,
    getDurableObjectNamespace: () => null,
  }),
}))

const { __handlePostForTests: handlePost } = await import('./ingest')

const TOKEN = 'test-shared-secret'
const ORIGINAL_TOKEN = process.env.CHM_EVENTS_INGEST_TOKEN

function makeRequest(
  body: unknown,
  opts: { token?: string; raw?: string } = {}
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  return new Request('https://dash.example.com/api/events/ingest', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  })
}

const genericPayload = {
  title: 'Disk usage high',
  severity: 'critical',
  resource: 'ch-node-1',
}

beforeEach(() => {
  _resetBucketsForTest()
  process.env.CHM_EVENTS_INGEST_TOKEN = TOKEN
})

afterAll(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.CHM_EVENTS_INGEST_TOKEN
  } else {
    process.env.CHM_EVENTS_INGEST_TOKEN = ORIGINAL_TOKEN
  }
})

describe('auth gate', () => {
  test('503s when CHM_EVENTS_INGEST_TOKEN is unconfigured (fail closed)', async () => {
    delete process.env.CHM_EVENTS_INGEST_TOKEN
    const res = await handlePost(
      makeRequest(genericPayload, { token: 'anything' })
    )
    expect(res.status).toBe(503)
  })

  test('401s with a missing bearer token', async () => {
    const res = await handlePost(makeRequest(genericPayload))
    expect(res.status).toBe(401)
  })

  test('401s with a wrong bearer token', async () => {
    const res = await handlePost(
      makeRequest(genericPayload, { token: 'wrong' })
    )
    expect(res.status).toBe(401)
  })

  test('proceeds with the correct bearer token', async () => {
    const res = await handlePost(makeRequest(genericPayload, { token: TOKEN }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })
})

describe('body validation', () => {
  test('400s on an empty body', async () => {
    const res = await handlePost(
      makeRequest(undefined, { token: TOKEN, raw: '' })
    )
    expect(res.status).toBe(400)
  })

  test('400s on invalid JSON', async () => {
    const res = await handlePost(
      makeRequest(undefined, { token: TOKEN, raw: '{not json' })
    )
    expect(res.status).toBe(400)
  })

  test('413s on an oversized body', async () => {
    const huge = JSON.stringify({ title: 'x'.repeat(300_000) })
    const res = await handlePost(
      makeRequest(undefined, { token: TOKEN, raw: huge })
    )
    expect(res.status).toBe(413)
  })
})

describe('queue present (cloud)', () => {
  test('enqueues the payload and returns 202', async () => {
    const sent: unknown[] = []
    const fakeQueue = {
      send: async (message: unknown) => {
        sent.push(message)
        return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }
      },
      sendBatch: async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
      metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
    } as unknown as Queue

    const res = await handlePost(
      makeRequest(genericPayload, { token: TOKEN }),
      {
        getQueue: () => fakeQueue,
      }
    )

    expect(res.status).toBe(202)
    const body = (await res.json()) as { accepted: boolean; mode: string }
    expect(body).toEqual({ accepted: true, mode: 'queued' })
    expect(sent).toEqual([genericPayload])
  })

  test('falls back to inline processing (never 500s) when queue.send() throws', async () => {
    const fakeQueue = {
      send: async () => {
        throw new Error('queue unavailable')
      },
      sendBatch: async () => {
        throw new Error('queue unavailable')
      },
      metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
    } as unknown as Queue

    const res = await handlePost(
      makeRequest(genericPayload, { token: TOKEN }),
      {
        getQueue: () => fakeQueue,
      }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean; mode: string }
    expect(body.accepted).toBe(true)
    expect(body.mode).toBe('inline')
  })
})

describe('no queue binding (self-host / not-yet-provisioned cloud)', () => {
  test('degrades gracefully to the inline path and returns 200 — never throws', async () => {
    const res = await handlePost(
      makeRequest(genericPayload, { token: TOKEN }),
      {
        getQueue: () => null,
      }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      accepted: boolean
      mode: string
      persisted: boolean
    }
    expect(body.accepted).toBe(true)
    expect(body.mode).toBe('inline')
    // D1 is mocked unbound in this file, so the event is accepted but the
    // write itself no-ops — exactly the self-host posture.
    expect(body.persisted).toBe(false)
  })

  test('also degrades gracefully when getPlatformBindings() itself throws', async () => {
    const res = await handlePost(
      makeRequest(genericPayload, { token: TOKEN }),
      {
        getQueue: () => {
          throw new Error('not in a Worker context')
        },
      }
    )
    expect(res.status).toBe(200)
  })
})

describe('rate limiting', () => {
  test('429s once the per-IP limit is exhausted', async () => {
    const limit = Number(process.env.RATE_LIMIT_API_PER_MIN ?? '100')
    let last: Response | undefined
    for (let i = 0; i < limit + 1; i += 1) {
      last = await handlePost(makeRequest(genericPayload, { token: TOKEN }), {
        getQueue: () => null,
      })
    }
    expect(last?.status).toBe(429)
  })
})
