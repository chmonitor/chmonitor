/**
 * #2172 — route-level regression: GET /api/v1/explorer/tables must reject a
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

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

import * as realTableRegistry from '@/lib/api/table-registry'

mock.module('@/lib/api/table-registry', () => ({
  ...realTableRegistry,
  getTableQuery: () => ({ query: 'SELECT 1', queryParams: {} }),
}))

const mockFetchData = mock(async () => ({
  data: [],
  metadata: { queryId: '', duration: 0, rows: 0, host: '0' },
  error: null,
}))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../tables')
const handler = getGetHandler(Route)

function get(hostId: string): Promise<Response> {
  return handler({
    request: new Request(
      `http://x/api/v1/explorer/tables?hostId=${hostId}&database=default`
    ),
  })
}

describe('GET /api/v1/explorer/tables — cloud demo-host guard (#2172)', () => {
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
