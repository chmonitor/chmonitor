/**
 * GET /api/v1/peerdb/log-patterns: reads every mirror, honours ?window=, caches
 * env-wide responses per window, and never caches per-connection responses
 * (same isolation rule as peerdb-metrics).
 */

import type { ResolvedPeerDBConfig } from '@/lib/peerdb/peerdb-auth'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: { PEERDB_API_URL: 'http://peerdb:8113' },
}))

const CONFIG: ResolvedPeerDBConfig = {
  baseUrl: 'http://peerdb:8113',
  authScheme: 'basic',
  secret: 'env-secret',
}

mock.module('@/lib/peerdb/resolve-request-config', () => ({
  PEERDB_CONNECTION_PARAM: 'connection',
  resolvePeerDBRequestConfig: async (request: Request) => {
    const id = new URL(request.url).searchParams.get('connection')
    if (id === null || id === 'owned') return CONFIG
    return null
  },
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>

const mod = await import('../peerdb/log-patterns')
const handler = (mod.Route.options.server as { handlers: { GET: GetHandler } })
  .handlers.GET

const MIRRORS = Array.from({ length: 40 }, (_, i) => `m${i}`)
let logCalls = 0
let listCalls = 0
const realFetch = globalThis.fetch

beforeEach(() => {
  logCalls = 0
  listCalls = 0
  mod.__clearLogPatternsCache()
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.endsWith('/v1/mirrors/list')) {
      listCalls++
      return Response.json({ mirrors: MIRRORS.map((name) => ({ name })) })
    }
    logCalls++
    const now = Date.now()
    return Response.json({
      errors: [
        {
          errorMessage: 'slot lag 123',
          errorType: 'error',
          errorTimestamp: new Date(now - 2 * 3_600_000).toISOString(),
        },
      ],
    })
  }) as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
})

const get = (q = '') =>
  handler({
    request: new Request(`http://chm.test/api/v1/peerdb/log-patterns${q}`),
  })

describe('GET /api/v1/peerdb/log-patterns', () => {
  test('reads every mirror and reports full coverage', async () => {
    const body = (await (await get()).json()) as { data: any }
    expect(logCalls).toBe(40)
    expect(body.data).toMatchObject({
      window: '24h',
      mirrorsRead: 40,
      mirrorsTotal: 40,
      partial: false,
    })
    expect(body.data.patterns[0].count).toBe(40)
  })

  test('applies the window: a 2h-old line is outside 1h', async () => {
    const body = (await (await get('?window=1h')).json()) as { data: any }
    expect(body.data.window).toBe('1h')
    expect(body.data.entries).toHaveLength(0)
  })

  test('caches env-wide responses per window', async () => {
    await get('?window=24h')
    await get('?window=24h')
    expect(listCalls).toBe(1)
    await get('?window=7d')
    expect(listCalls).toBe(2)
  })

  test('never caches per-connection responses', async () => {
    await get('?connection=owned')
    await get('?connection=owned')
    expect(listCalls).toBe(2)
  })

  test('an unresolvable connection fails closed with 503', async () => {
    await get() // warm the env cache
    const res = await get('?connection=evil')
    expect(res.status).toBe(503)
  })
})
