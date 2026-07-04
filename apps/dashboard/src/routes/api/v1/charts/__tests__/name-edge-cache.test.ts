/**
 * Edge-cache safety test for GET /api/v1/charts/$name (#2181).
 *
 * The shared Cloudflare `caches.default` cache has NO per-user partition, so
 * writing an authenticated/per-user response into it would leak that
 * response to the next visitor who produces the same cache key. This is the
 * one test that most directly protects against that: it exercises the REAL
 * `isSignedIn` resolution (via `@/lib/feature-permissions/server`, mocking
 * only the underlying Clerk SDK call it makes) rather than stubbing the
 * edge-cache gate itself, so a regression that weakens the gate would fail
 * this test even if the gate function's own unit tests still passed.
 *
 * Mocking strategy mirrors routes/api/v1/health/actions.test.ts: mock.module()
 * for cloudflare:workers, the ClickHouse-touching query executor, and the
 * Clerk SDK — all declared before the dynamic import of the route module.
 * `@/lib/feature-permissions/server` itself is REAL (not mocked) so
 * `isAnonymousPublicReadRequest` runs its real auth-provider branch.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// `CHM_AUTH_PROVIDER=clerk` + `CHM_CLERK_PUBLIC_READ=true` is the one
// configuration where the edge cache can ever be eligible — mirrors the cloud
// deployment's public-demo posture. Mutated per-test via `clerkAuthResult`.
mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    CHM_AUTH_PROVIDER: 'clerk',
    CHM_CLERK_PUBLIC_READ: 'true',
  },
}))

// The real `@/lib/feature-permissions/server` (unmocked) calls this for the
// clerk provider. `null` == no session == anonymous; `{ userId }` == signed in.
let clerkAuthResult: { userId?: string } | null = null
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => clerkAuthResult,
}))

// Stub the ClickHouse-touching executor so the test never needs a live
// ClickHouse instance. `running-queries-count` (a real, permission-less,
// single-query chart from overview-charts.ts) is used unmocked from the real
// chart-registry so `queryDef.cachePolicy`/`permission` reflect production.
mock.module('@/lib/api/query-executor', () => ({
  isValidInterval: () => true,
  executeChartQuery: async () => ({
    dataJson: '[{"count":1}]',
    metadata: { queryId: 'q1', duration: 1, rows: 1 },
    error: undefined,
    executedSql: 'SELECT COUNT() as count FROM system.processes',
    clickhouseVersion: '24.1',
  }),
  executeMultiChartQuery: async () => ({ results: [] }),
}))

const { handler } = await import('../$name')

function makeRequest(): Request {
  return new Request(
    'https://dash.example.com/api/v1/charts/running-queries-count?hostId=0'
  )
}

function installMockEdgeCache() {
  const put = mock(async (_key: Request, _res: Response) => undefined)
  const match = mock(async (_key: Request) => undefined)
  ;(globalThis as { caches?: unknown }).caches = { default: { put, match } }
  return { put, match }
}

describe('GET /api/v1/charts/$name — shared edge cache safety gate (#2181)', () => {
  beforeEach(async () => {
    const { _resetAppConfigCache } = await import(
      '@/lib/feature-permissions/server'
    )
    _resetAppConfigCache()
  })

  test('an authenticated (signed-in) request is NEVER written to the shared edge cache', async () => {
    clerkAuthResult = { userId: 'user_123' } // isSignedIn: true
    const { put } = installMockEdgeCache()

    const res = await handler(makeRequest(), 'running-queries-count')

    expect(res.status).toBe(200)
    expect(put).not.toHaveBeenCalled()
  })

  test('control: an anonymous request under public-read IS written to the shared edge cache', async () => {
    clerkAuthResult = null // isSignedIn: false
    const { put } = installMockEdgeCache()

    const res = await handler(makeRequest(), 'running-queries-count')

    expect(res.status).toBe(200)
    expect(put).toHaveBeenCalledTimes(1)
  })
})
