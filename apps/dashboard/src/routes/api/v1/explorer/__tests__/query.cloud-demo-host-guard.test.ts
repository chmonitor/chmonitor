/**
 * #2172 — route-level regression: GET+POST /api/v1/explorer/query must
 * reject a hand-crafted non-negative `hostId` for an authenticated cloud
 * principal (the hidden demo host), while leaving OSS and anonymous-cloud
 * callers unaffected. Mirrors charts/__tests__/cloud-demo-host-guard.test.ts.
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

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

import * as realFeaturePermissions from '@/lib/feature-permissions/server'

mock.module('@/lib/feature-permissions/server', () => ({
  ...realFeaturePermissions,
  authorizeFeatureRequest: mock(async () => null),
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

const mockFetchData = mock(async () => ({
  data: [],
  metadata: { queryId: '', duration: 0, rows: 0, host: '0' },
  error: null,
}))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => undefined,
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

function getHandler(
  route: { options: { server?: unknown } },
  method: 'GET' | 'POST'
): Handler {
  const handlers = (
    route.options.server as { handlers?: Record<string, Handler> }
  )?.handlers
  const fn = handlers?.[method]
  if (!fn) throw new Error(`Route has no ${method} handler`)
  return fn
}

const { Route } = await import('../query')
const getHandlerFn = getHandler(Route, 'GET')
const postHandlerFn = getHandler(Route, 'POST')

function get(hostId: string): Promise<Response> {
  return getHandlerFn({
    request: new Request(
      `http://x/api/v1/explorer/query?hostId=${hostId}&sql=SELECT+1`
    ),
  })
}

function post(hostId: number): Promise<Response> {
  return postHandlerFn({
    request: new Request('http://x/api/v1/explorer/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1', hostId }),
    }),
  })
}

describe('GET /api/v1/explorer/query — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockFetchData.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
  })

  test('authenticated cloud + hostId=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockFetchData).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      success: boolean
      data: unknown[]
      metadata: { unavailable: { reason: string } }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable.reason).toBe('demo_hidden')
  })
})

describe('POST /api/v1/explorer/query — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockFetchData.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = false
    signedIn = true
    const res = await post(0)
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = true
    signedIn = false
    const res = await post(0)
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
  })

  test('authenticated cloud + hostId=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await post(0)
    expect(res.status).toBe(200)
    expect(mockFetchData).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      success: boolean
      data: unknown[]
      metadata: { unavailable: { reason: string } }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable.reason).toBe('demo_hidden')
  })
})
