/**
 * #2172 — route-level regression: GET /api/v1/charts/$name must reject a
 * hand-crafted non-negative `hostId` for an authenticated cloud principal
 * (the hidden demo host), while leaving OSS and anonymous-cloud callers
 * unaffected. See lib/cloud/reject-demo-host.ts for the unit-level coverage
 * of the underlying boolean logic.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

let cloudMode = false
let signedIn = false

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    get CHM_CLOUD_MODE() {
      return cloudMode ? 'true' : 'false'
    },
  },
}))

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

import * as realRegistry from '@/lib/api/chart-registry'

mock.module('@/lib/api/chart-registry', () => ({
  ...realRegistry,
  hasChart: () => true,
  getAvailableCharts: () => ['c'],
  getChartQuery: () => ({ query: 'SELECT 1', optional: false }),
}))

import * as realExecutor from '@/lib/api/query-executor'

const executeChartQuery = mock(async () => ({
  dataJson: '[]',
  metadata: {},
  error: undefined,
  executedSql: 'SELECT 1',
  clickhouseVersion: null,
}))

mock.module('@/lib/api/query-executor', () => ({
  ...realExecutor,
  executeChartQuery,
}))

const { handler } = await import('@/routes/api/v1/charts/$name')

async function get(hostId: string) {
  return handler(new Request(`http://x/api/v1/charts/c?hostId=${hostId}`), 'c')
}

describe('GET /api/v1/charts/$name — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    executeChartQuery.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches executor)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeChartQuery).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches executor)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeChartQuery).toHaveBeenCalled()
  })

  test('authenticated cloud + hostId=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeChartQuery).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      success: boolean
      data: unknown[]
      metadata: { unavailable: { reason: string } }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable.reason).toBe('demo_hidden')
  })

  test('authenticated cloud + negative hostId is invalid at this route (own-host fetches never hit /charts with hostId<0)', async () => {
    // The chart route's own boundary rejects negative hostId regardless of
    // cloud/auth state — user-connection hosts are served by a different
    // route (user-connections/charts). Confirms the demo guard never fires
    // for a negative id (short-circuits before isSignedInServer is even
    // relevant), matching isDemoHostBlockedForRequest's own unit coverage.
    cloudMode = true
    signedIn = true
    const res = await get('-1')
    expect(res.status).toBe(400)
  })
})
