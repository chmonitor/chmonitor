/**
 * #2172 — route-level regression: GET /api/v1/notifications must reject a
 * hand-crafted non-negative `hostId` for an authenticated cloud principal
 * (the hidden demo host), while leaving OSS and anonymous-cloud callers
 * unaffected. Mirrors charts/__tests__/cloud-demo-host-guard.test.ts.
 */

// Type-only, so it is erased at runtime and cannot disturb the `mock.module`
// calls below, which must be installed before the route is dynamically
// imported. Importing the handler's own response type (rather than restating
// its shape inline) is what stops the two from drifting again — #3682 added a
// field and the duplicated annotation is exactly what failed CI.
import type { NotificationsResponse } from '../notifications'

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

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

const mockGetClient = mock(async () => ({
  query: async () => ({ json: async () => [] }),
}))

mock.module('@chm/clickhouse-client', () => ({
  getClient: mockGetClient,
  // #3682: the route now resolves the cluster fan-out capability before
  // counting readonly replicas, and that capability reads the shared
  // capability cache, which uses `fetchData`. The mock replaces the whole
  // module, so `fetchData` has to be here or the import fails.
  fetchData: async () => ({
    data: [
      { kind: 'table', name: 'system.replicas' },
      { kind: 'cluster', name: 'default' },
    ],
    metadata: {},
    error: undefined,
  }),
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../notifications')
const handler = getGetHandler(Route)

function get(hostId: string): Promise<Response> {
  return handler({
    request: new Request(`http://x/api/v1/notifications?hostId=${hostId}`),
  })
}

describe('GET /api/v1/notifications — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockGetClient.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockGetClient).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches ClickHouse)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockGetClient).toHaveBeenCalled()
  })

  test('authenticated cloud + hostId=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(mockGetClient).not.toHaveBeenCalled()
    // `data` is typed with the route's own exported `NotificationsResponse`
    // rather than a hand-written inline shape. #3682 added
    // `clusterViewUnavailable` and the duplicated annotation is precisely what
    // drifted, failing CI with TS2769 while the handler itself was correct.
    const body = (await res.json()) as {
      success: boolean
      data: NotificationsResponse
      unavailable: { reason: string }
    }
    expect(body.success).toBe(true)
    // #3682: `clusterViewUnavailable: null` — the demo host is hidden outright,
    // so there is no cluster-wide view to degrade and nothing for a client to
    // warn about.
    expect(body.data).toEqual({
      notifications: [],
      totalCount: 0,
      clusterViewUnavailable: null,
    })
    expect(body.unavailable.reason).toBe('demo_hidden')
  })
})
