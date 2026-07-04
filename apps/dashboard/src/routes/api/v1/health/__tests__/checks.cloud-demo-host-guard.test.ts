/**
 * #2172 — route-level regression: GET /api/v1/health/checks must reject a
 * hand-crafted non-negative `hostId` for an authenticated cloud principal
 * (the hidden demo host), while leaving OSS and anonymous-cloud callers
 * unaffected. Mirrors charts/__tests__/cloud-demo-host-guard.test.ts.
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

import * as realFeaturePermissions from '@/lib/feature-permissions/server'

mock.module('@/lib/feature-permissions/server', () => ({
  ...realFeaturePermissions,
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

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../checks')
const handler = getGetHandler(Route)

function get(hostId: string): Promise<Response> {
  return handler({
    request: new Request(
      `http://x/api/v1/health/checks?hostId=${hostId}&charts=c`
    ),
  })
}

describe('GET /api/v1/health/checks — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    executeChartQuery.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches the executor)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeChartQuery).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches the executor)', async () => {
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
      checks: Record<string, { data: unknown[]; error?: { type: string } }>
    }
    expect(body.success).toBe(true)
    expect(body.checks.c.data).toEqual([])
    expect(body.checks.c.error?.type).toBe('demo_hidden')
  })
})
