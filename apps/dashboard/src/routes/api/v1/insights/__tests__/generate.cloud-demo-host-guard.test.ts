/**
 * #2172 — route-level regression: POST /api/v1/insights/generate must reject
 * a hand-crafted non-negative `hostId` for an authenticated cloud principal
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

const mockGenerateInsights = mock(async () => [{ title: 'demo insight' }])

mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: mockGenerateInsights,
}))

mock.module('@/lib/insights/prompts', () => ({
  isInsightPromptStyle: () => false,
}))

mock.module('@/lib/insights/resolve-model', () => ({
  resolveInsightModel: () => undefined,
}))

type PostHandler = (ctx: { request: Request }) => Promise<Response>

function getPostHandler(route: { options: { server?: unknown } }): PostHandler {
  const handlers = (
    route.options.server as { handlers?: { POST?: PostHandler } }
  )?.handlers
  const fn = handlers?.POST
  if (!fn) throw new Error('Route has no POST handler')
  return fn
}

const { Route } = await import('../generate')
const handler = getPostHandler(Route)

function post(host: string): Promise<Response> {
  return handler({
    request: new Request(`http://x/api/v1/insights/generate?host=${host}`, {
      method: 'POST',
    }),
  })
}

describe('POST /api/v1/insights/generate — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockGenerateInsights.mockClear()
  })

  test('OSS: authenticated caller + host=0 is unaffected (runs the pipeline)', async () => {
    cloudMode = false
    signedIn = true
    const res = await post('0')
    expect(res.status).toBe(200)
    expect(mockGenerateInsights).toHaveBeenCalled()
  })

  test('anonymous cloud: host=0 is unaffected (runs the pipeline)', async () => {
    cloudMode = true
    signedIn = false
    const res = await post('0')
    expect(res.status).toBe(200)
    expect(mockGenerateInsights).toHaveBeenCalled()
  })

  test('authenticated cloud + host=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await post('0')
    expect(res.status).toBe(200)
    expect(mockGenerateInsights).not.toHaveBeenCalled()
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
