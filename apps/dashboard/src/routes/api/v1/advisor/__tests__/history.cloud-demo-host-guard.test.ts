/**
 * #2172 + #3139 — GET /api/v1/advisor/history
 *
 * Guest/OSS hostId=0 must reach the env/demo host. Signed-in cloud + hostId=0 returns
 * demo_hidden with data:[]. Kind defaults to all (no query_kind). Dashboard
 * queries are excluded unless includeSelf=1.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let cloudMode = false
let signedIn = false

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123', // pragma: allowlist secret
    CLICKHOUSE_USER: 'default', // pragma: allowlist secret
    CLICKHOUSE_PASSWORD: '', // pragma: allowlist secret
    get CHM_CLOUD_MODE() {
      return cloudMode ? 'true' : 'false'
    },
  },
}))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined), // pragma: allowlist secret
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

mock.module('@chm/logger', () => ({
  error: mock(() => undefined),
  log: mock(() => undefined),
  isDebugEnabled: mock(() => false),
}))

type FetchArg = {
  query: string
  query_params: Record<string, string>
}

const mockFetchData = mock(async (_args?: unknown) => ({
  data: [
    {
      query_id: 'q1',
      query: 'SELECT 1',
      user: 'default',
      query_duration_ms: 12,
      event_time: '2026-08-19 00:00:00',
      read_rows: 1,
    },
  ] as unknown,
  metadata: { queryId: '' } as Record<string, unknown>,
  error: null as { type?: string; message?: string } | null,
}))

function lastFetchArg(): FetchArg {
  const calls = mockFetchData.mock.calls as unknown as Array<[FetchArg]>
  const arg = calls[0]?.[0]
  if (!arg) throw new Error('fetchData was not called')
  return arg
}

mock.module('@chm/clickhouse-client', () => ({ // pragma: allowlist secret
  // pragma: allowlist secret
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

const { Route } = await import('../history')
const handler = getGetHandler(Route)

function get(search: string): Promise<Response> {
  return handler({
    request: new Request(`http://x/api/v1/advisor/history?${search}`),
  })
}

describe('GET /api/v1/advisor/history — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockFetchData.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches fetchData)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('hostId=0')
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches fetchData)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('hostId=0')
    expect(res.status).toBe(200)
    expect(mockFetchData).toHaveBeenCalled()
    const body = (await res.json()) as { success: boolean; data: unknown[] }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  test('authenticated cloud + hostId=0: rejected with demo_hidden empty payload', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('hostId=0')
    expect(res.status).toBe(200)
    expect(mockFetchData).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      success: boolean
      data: unknown[]
      metadata: { unavailable: { reason: string; message: string } }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable.reason).toBe('demo_hidden')
    expect(body.metadata.unavailable.message.length).toBeGreaterThan(0)
  })
})

describe('GET /api/v1/advisor/history — picker filters (#3139)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    mockFetchData.mockClear()
  })

  test('omits query_kind when kind is absent (All)', async () => {
    await get('hostId=0&hours=24')
    expect(mockFetchData).toHaveBeenCalled()
    const arg = lastFetchArg()
    expect(arg.query).not.toContain('query_kind')
    expect(arg.query_params.kind).toBeUndefined()
  })

  test('kind=all omits query_kind', async () => {
    await get('hostId=0&kind=all')
    const arg = lastFetchArg()
    expect(arg.query).not.toContain('query_kind')
    expect(arg.query_params.kind).toBeUndefined()
  })

  test('kind=Select binds query_kind', async () => {
    await get('hostId=0&kind=Select')
    const arg = lastFetchArg()
    expect(arg.query).toContain('query_kind = {kind:String}')
    expect(arg.query_params.kind).toBe('Select')
  })

  test('unknown kind is a 400', async () => {
    const res = await get('hostId=0&kind=Nonsense')
    expect(res.status).toBe(400)
    expect(mockFetchData).not.toHaveBeenCalled()
  })

  test('default excludes dashboard queries', async () => {
    await get('hostId=0')
    const arg = lastFetchArg()
    expect(arg.query_params.selfFingerprint).toBeDefined()
    expect(arg.query_params.selfFingerprint.length).toBeGreaterThan(0)
    expect(arg.query).toContain('position(query, {selfFingerprint:String}) = 0')
  })

  test('includeSelf=1 skips the dashboard fingerprint', async () => {
    await get('hostId=0&includeSelf=1')
    const arg = lastFetchArg()
    expect(arg.query_params.selfFingerprint).toBeUndefined()
    expect(arg.query).not.toContain('selfFingerprint')
  })

  test('query errors become 503 with a message the UI can show', async () => {
    mockFetchData.mockImplementationOnce(async () => ({
      data: null,
      metadata: {},
      error: { type: 'query_error', message: 'query_log is empty' },
    }))
    const res = await get('hostId=0')
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      success: boolean
      error: { message: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.message).toBe('query_log is empty')
  })
})
