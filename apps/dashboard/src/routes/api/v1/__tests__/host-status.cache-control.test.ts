/**
 * #3529 — no response from GET /api/v1/host-status may be stored by a shared
 * cache. The zone Cache Rule on dash.chmonitor.dev stored the 200 and replayed
 * it for its whole TTL: on 2026-09-30 the demo host refused connections for 80
 * seconds while host-status kept answering `up` with a byte-identical `uptime`
 * and /api/healthz correctly reported 503 / status: "down". A status probe
 * that lies is worse than one that is absent, so this asserts the header on
 * every branch — a stored 400 would outlive the config change that fixes it,
 * and a stored error would outlive the outage.
 *
 * Sibling of host-status.cloud-demo-host-guard.test.ts, which drives the same
 * handler through the same env/ClickHouse mocks; healthz.test.ts is the
 * precedent (same no-store value, same bug, one route over).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const NO_STORE = 'no-cache, no-store, must-revalidate'

let cloudMode = false
let signedIn = false
let upstreamUp = true

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

const mockGetClient = mock(async () => {
  if (!upstreamUp) throw new Error('Connection failed')
  return {
    query: async () => ({
      json: async () => [
        { version: '24.1', uptime: '1 day', hostname: 'demo-host' },
      ],
    }),
  }
})

mock.module('@chm/clickhouse-client', () => ({
  getClient: mockGetClient,
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../host-status')
const handler = getGetHandler(Route)

function get(query: string): Promise<Response> {
  return handler({
    request: new Request(`http://x/api/v1/host-status?${query}`),
  })
}

// The whole point: a shared cache must not be able to answer this route later.
function expectUncacheable(res: Response) {
  expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
}

beforeEach(() => {
  cloudMode = false
  signedIn = false
  upstreamUp = true
})

describe('GET /api/v1/host-status — Cache-Control (#3529)', () => {
  // This is the branch that produced the false green: the last known-good 200
  // was stored and replayed while the host was refusing connections.
  test('the 200 host-up response is not cacheable', async () => {
    const res = await get('hostId=0')

    expect(res.status).toBe(200)
    expectUncacheable(res)
  })

  test('the 200 demo-hidden response is not cacheable', async () => {
    cloudMode = true
    signedIn = true

    const res = await get('hostId=0')

    expect(res.status).toBe(200)
    expectUncacheable(res)
  })

  test('the 400 missing-hostId response is not cacheable', async () => {
    const res = await get('')

    expect(res.status).toBe(400)
    expectUncacheable(res)
  })

  test('the 400 out-of-range response is not cacheable', async () => {
    const res = await get('hostId=7')

    expect(res.status).toBe(400)
    expectUncacheable(res)
  })

  // Assert only "not the success branch" — the status code is the error
  // classifier's contract and is covered by its own tests.
  test('the upstream-unreachable response is not cacheable', async () => {
    upstreamUp = false

    const res = await get('hostId=0')

    expect(res.status).not.toBe(200)
    expectUncacheable(res)
  })
})
