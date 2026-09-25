/**
 * H1 regression: GET /api/v1/peerdb-metrics must resolve + authenticate the
 * `?connection=` selector BEFORE consulting the response cache, and must never
 * serve (or store) per-connection responses from the shared cache.
 *
 * Threat: the cache was keyed by raw connection id and checked before
 * `resolvePeerDBRequestConfig`, so a request with an unowned `?connection=evil`
 * could receive another user's (or the env-wide) cached fleet data.
 *
 * Strategy: warm the env-wide cache, then prove an unowned connection gets
 * `configured:false` (fail-closed, no cached fleet), and that owned
 * per-connection requests always hit upstream (never cached).
 */

import type { ResolvedPeerDBConfig } from '@/lib/peerdb/peerdb-auth'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: { PEERDB_API_URL: 'http://peerdb:8113' },
}))

const ENV_CONFIG: ResolvedPeerDBConfig = {
  baseUrl: 'http://peerdb:8113',
  authScheme: 'basic',
  secret: 'env-secret',
}
const OWNED_CONFIG: ResolvedPeerDBConfig = {
  baseUrl: 'http://peerdb:8113',
  // Bearer so the test upstream can distinguish per-connection traffic from
  // the env-wide Basic credential by header inspection.
  authScheme: 'bearer',
  secret: 'conn-secret',
}

let resolveCalls = 0
let revocableAuthorized = true

mock.module('@/lib/peerdb/resolve-request-config', () => ({
  PEERDB_CONNECTION_PARAM: 'connection',
  resolvePeerDBRequestConfig: async (request: Request) => {
    resolveCalls += 1
    const id = new URL(request.url).searchParams.get('connection')
    if (id === null) return ENV_CONFIG
    if (id === 'owned') return OWNED_CONFIG
    if (id === 'revocable') return revocableAuthorized ? OWNED_CONFIG : null
    return null // unowned / unknown → fail closed
  },
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const { Route } = await import('../peerdb-metrics')
const handler = getGetHandler(Route)

let fetchCalls = 0
let seenAuth: (string | null)[] = []
const realFetch = globalThis.fetch

function fleetFor(auth: string | null): Record<string, unknown> {
  const tag = auth?.includes('conn-secret') ? 'conn-mirror' : 'env-mirror'
  return {
    mirrors: [{ name: tag, status: 'STATUS_RUNNING', isCdc: true }],
  }
}

beforeEach(() => {
  fetchCalls = 0
  resolveCalls = 0
  revocableAuthorized = true
  seenAuth = []
  globalThis.fetch = mock(async (url: string | URL | Request, init) => {
    fetchCalls += 1
    const u = String(url instanceof Request ? url.url : url)
    const headers = (init as { headers?: Record<string, string> })?.headers
    const auth =
      headers?.Authorization ??
      (url instanceof Request ? url.headers.get('Authorization') : null) ??
      null
    seenAuth.push(auth)
    if (u.endsWith('/v1/mirrors/list')) {
      return Response.json(fleetFor(auth))
    }
    if (u.endsWith('/v1/peers/list')) {
      return Response.json({ sourceItems: [] })
    }
    if (u.includes('/v1/mirrors/total_rows_synced/')) {
      return Response.json({ totalRowsSynced: 7 })
    }
    if (u.endsWith('/v1/mirrors/status')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        flow_job_name?: string
      }
      return Response.json({
        currentFlowState:
          body.flow_job_name === 'conn-mirror'
            ? 'STATUS_FAILED'
            : 'STATUS_RUNNING',
      })
    }
    return Response.json({}, { status: 404 })
  }) as typeof fetch
})

async function get(path: string): Promise<{
  status: number
  headers: Headers
  json: Record<string, unknown>
}> {
  const res = await handler({
    request: new Request(`http://x${path}`),
  })
  return {
    status: res.status,
    headers: res.headers,
    json: (await res.json()) as Record<string, unknown>,
  }
}

function metricsOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data as Record<string, unknown>).metrics as Record<
    string,
    unknown
  >
}

describe('GET /api/v1/peerdb-metrics cache isolation', () => {
  test('authorizes before the env cache and keeps unowned selectors closed', async () => {
    // Warm the env cache.
    const first = await get('/api/v1/peerdb-metrics')
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    expect(
      (metricsOf(first.json).byStatus as Record<string, number>).running
    ).toBe(1)
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(
      seenAuth.every((auth) => auth === `Basic ${btoa(':env-secret')}`)
    ).toBe(true)
    const warmedCalls = fetchCalls
    expect(warmedCalls).toBeGreaterThan(0)
    expect(resolveCalls).toBe(1)

    // Cache hit: no new upstream calls, but authorization still runs.
    await get('/api/v1/peerdb-metrics')
    expect(fetchCalls).toBe(warmedCalls)
    expect(resolveCalls).toBe(2)

    // Unowned connection: must NOT receive the warm env cache — fail closed.
    const beforeEvilResolve = resolveCalls
    const evil = await get('/api/v1/peerdb-metrics?connection=evil')
    expect(evil.status).toBe(200)
    expect(resolveCalls).toBe(beforeEvilResolve + 1)
    expect(evil.headers.get('Cache-Control')).toBe('private, no-store')
    expect((evil.json.data as Record<string, unknown>).configured).toBe(false)
    expect(fetchCalls).toBe(warmedCalls) // no upstream fetch either
  })

  test('does not reuse a previously authorized connection after revocation', async () => {
    const first = await get('/api/v1/peerdb-metrics?connection=revocable')
    expect((first.json.data as Record<string, unknown>).configured).toBe(true)
    const callsAfterFirst = fetchCalls
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Same URL, now an unowned/unauthorized request. A cache lookup before
    // authorization would return the first response and skip this resolver.
    revocableAuthorized = false
    const denied = await get('/api/v1/peerdb-metrics?connection=revocable')
    expect((denied.json.data as Record<string, unknown>).configured).toBe(false)
    expect(fetchCalls).toBe(callsAfterFirst)
    expect(resolveCalls).toBe(2)
  })

  test('uses the owned source and never caches or poisons the env snapshot', async () => {
    // Ensure the env entry exists even if this test runs first.
    await get('/api/v1/peerdb-metrics')
    const authBeforeOwned = seenAuth.length
    const one = await get('/api/v1/peerdb-metrics?connection=owned')
    expect(one.headers.get('Cache-Control')).toBe('private, no-store')
    expect(metricsOf(one.json).failedMirrors).toEqual(['conn-mirror'])
    const ownedAuth = seenAuth.slice(authBeforeOwned)
    expect(ownedAuth.length).toBeGreaterThan(0)
    expect(ownedAuth.every((auth) => auth === 'Bearer conn-secret')).toBe(true)
    const afterOne = fetchCalls
    expect(afterOne).toBeGreaterThan(0)

    // Second identical request must re-fetch (per-connection: no cache).
    const two = await get('/api/v1/peerdb-metrics?connection=owned')
    expect(metricsOf(two.json).failedMirrors).toEqual(['conn-mirror'])
    expect(fetchCalls).toBeGreaterThan(afterOne)
    const afterTwo = fetchCalls

    // A per-connection response must not replace the env-wide cache entry.
    const envAgain = await get('/api/v1/peerdb-metrics')
    expect(metricsOf(envAgain.json).failedMirrors).toEqual([])
    expect(fetchCalls).toBe(afterTwo)
  })
})

// Restore the real fetch after the file so later files in the process keep it.
afterAll(() => {
  globalThis.fetch = realFetch
})
