/**
 * GET /api/healthz must never be served from a cache.
 *
 * The failure mode of this bug is a *green* endpoint: Cloudflare stores the
 * 200 (it does not store the 503), so a readiness probe keeps reporting
 * `ok: true` after every ClickHouse host goes down, and nothing else in CI or
 * in the deploy check notices. Hence a direct header assertion on all three
 * response branches — it fails the moment the header is dropped.
 *
 * Co-located with the route, like the other single-route tests
 * (events/ingest.test.ts, v1/releases.test.ts, v1/webhooks/github.test.ts);
 * api/__tests__/ holds only the cross-route contract tests.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// One mutable object, mutated in place: the route reads `env` at call time, so
// reassigning the binding would not be visible to it.
const envStub: Record<string, string | undefined> = {
  CHM_HEALTHZ_TIMEOUT_MS: '1',
}
mock.module('cloudflare:workers', () => ({ env: envStub }))

let pingOutcome: 'up' | 'down' = 'up'
mock.module('@chm/clickhouse-client', () => ({
  getClient: mock(async () => ({
    query: async () => {
      if (pingOutcome === 'down') throw new Error('connection refused')
      return { text: async () => '{"result":1}' }
    },
  })),
}))

mock.module('@chm/logger', () => ({
  debug: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
}))

const {
  __handleGetForTests: handleGet,
  __resolvePingTimeoutMsForTests: resolvePingTimeoutMs,
} = await import('./healthz')

const NO_STORE = 'no-cache, no-store, must-revalidate'

function setHosts(...hosts: string[]) {
  envStub.CLICKHOUSE_HOST = hosts.join(',') || undefined
}

beforeEach(() => {
  pingOutcome = 'up'
  delete envStub.CLICKHOUSE_HOST
})

describe('GET /api/healthz — Cache-Control', () => {
  test('the 200 all-hosts-up response is not cacheable', async () => {
    setHosts('http://localhost:8123')

    const res = await handleGet()

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  test('the 503 host-down response is not cacheable', async () => {
    setHosts('http://localhost:8123')
    pingOutcome = 'down'

    const res = await handleGet()

    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  test('the 503 no-hosts-configured response is not cacheable', async () => {
    const res = await handleGet()

    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
  })
})

describe('CHM_HEALTHZ_TIMEOUT_MS parsing', () => {
  test('a positive value is used as-is', () => {
    expect(resolvePingTimeoutMs('2500')).toBe(2500)
  })

  // AbortSignal.timeout(-5) throws a RangeError, which marks every host down.
  test.each([
    '-5',
    '-1',
    '0',
    'abc',
    '',
    undefined,
  ])('falls back to 3000ms for %p', (raw) => {
    expect(resolvePingTimeoutMs(raw)).toBe(3000)
  })
})
