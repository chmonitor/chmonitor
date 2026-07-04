/**
 * #2172 — route-level regression: GET /api/v1/insights must reject a
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

const mockReadInsights = mock(async () => [{ title: 'demo insight' }])

mock.module('@/lib/insights/read-insights', () => ({
  readInsights: mockReadInsights,
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../insights')
const handler = getGetHandler(Route)

function get(host: string): Promise<Response> {
  return handler({
    request: new Request(`http://x/api/v1/insights?host=${host}`),
  })
}

describe('GET /api/v1/insights — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockReadInsights.mockClear()
  })

  test('OSS: authenticated caller + host=0 is unaffected (reaches the store)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockReadInsights).toHaveBeenCalled()
  })

  test('anonymous cloud: host=0 is unaffected (reaches the store)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockReadInsights).toHaveBeenCalled()
  })

  test('authenticated cloud + host=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockReadInsights).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      insights: unknown[]
      count: number
      unavailable: { reason: string }
    }
    expect(body.insights).toEqual([])
    expect(body.count).toBe(0)
    expect(body.unavailable.reason).toBe('demo_hidden')
  })
})
