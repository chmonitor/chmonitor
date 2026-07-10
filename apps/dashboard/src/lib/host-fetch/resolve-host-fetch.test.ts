/**
 * Tests for resolve-host-fetch.ts
 *
 * Tests the pure resolution helpers (isCustomHost, findMergedHost) directly,
 * and the async fetch functions (fetchChartForHost, fetchTableForHost) by
 * mocking the I/O boundary modules:
 *   - @/lib/swr/api-fetch        → apiFetch
 *   - @/lib/swr/fetch-error      → throwIfNotOk
 *   - @/lib/connection-sessions/session-manager → getBrowserConnectionSessionToken
 */

import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'
import type { BrowserConnection } from '@/lib/types/browser-connection'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock I/O boundary modules before importing the module under test
// ---------------------------------------------------------------------------

const mockApiFetch = mock(async (_input: unknown, _init?: unknown) => {
  return new Response(JSON.stringify({ data: [], success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

const mockThrowIfNotOk = mock(async (_response: unknown, _msg?: string) => {
  // no-op by default (response is OK)
})

const mockGetSessionToken = mock(async (_conn: unknown): Promise<string> => {
  return 'mock-session-token'
})

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: mockApiFetch,
}))

mock.module('@/lib/swr/fetch-error', () => ({
  throwIfNotOk: mockThrowIfNotOk,
}))

mock.module('@/lib/connection-sessions/session-manager', () => ({
  getBrowserConnectionSessionToken: mockGetSessionToken,
}))

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  fetchChartForHost,
  fetchTableForHost,
  findMergedHost,
  isCustomHost,
} from './resolve-host-fetch'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEnvHost(id: number): MergedHostInfo {
  return {
    id,
    name: `host-${id}`,
    host: 'http://ch:8123',
    user: 'default',
    source: 'env',
    engine: 'clickhouse',
  }
}

function makeDatabaseHost(id: number, connectionId: string): MergedHostInfo {
  return {
    id,
    name: `db-host-${id}`,
    host: 'http://ch:8123',
    user: 'default',
    source: 'database',
    engine: 'clickhouse',
    connectionId,
  }
}

function makeBrowserHost(id: number): MergedHostInfo {
  return {
    id,
    name: `browser-host-${id}`,
    host: 'http://ch:8123',
    user: 'default',
    source: 'browser',
    engine: 'clickhouse',
  }
}

function makeBrowserConnection(id: string, hostId: number): BrowserConnection {
  return {
    id,
    hostId,
    name: 'my-browser-conn',
    host: 'https://ch.cloud:8443',
    user: 'default',
    password: 'secret',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

function makeOkResponse(body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
}

function makeErrorResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// isCustomHost
// ---------------------------------------------------------------------------

describe('isCustomHost', () => {
  test('returns false when hostId is undefined', () => {
    expect(isCustomHost(undefined)).toBe(false)
  })

  test('returns false for non-negative hostId', () => {
    expect(isCustomHost(0)).toBe(false)
    expect(isCustomHost(1)).toBe(false)
    expect(isCustomHost(100)).toBe(false)
  })

  test('returns true for negative hostId (browser/custom host)', () => {
    expect(isCustomHost(-1)).toBe(true)
    expect(isCustomHost(-2)).toBe(true)
    expect(isCustomHost(-100)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// findMergedHost
// ---------------------------------------------------------------------------

describe('findMergedHost', () => {
  const hosts: MergedHostInfo[] = [
    makeEnvHost(0),
    makeEnvHost(1),
    makeDatabaseHost(2, 'conn-uuid'),
  ]

  test('returns undefined when hostId is undefined', () => {
    expect(findMergedHost(hosts, undefined)).toBeUndefined()
  })

  test('returns undefined when no host matches', () => {
    expect(findMergedHost(hosts, 99)).toBeUndefined()
  })

  test('returns the matching host by id', () => {
    const result = findMergedHost(hosts, 0)
    expect(result).toBeDefined()
    expect(result?.id).toBe(0)
    expect(result?.source).toBe('env')
  })

  test('returns the correct host when multiple hosts present', () => {
    const result = findMergedHost(hosts, 1)
    expect(result?.id).toBe(1)
  })

  test('returns a database host with connectionId', () => {
    const result = findMergedHost(hosts, 2)
    expect(result?.source).toBe('database')
    expect(result?.connectionId).toBe('conn-uuid')
  })

  test('works with an empty hosts array', () => {
    expect(findMergedHost([], 0)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// fetchChartForHost — env host routing
// ---------------------------------------------------------------------------

describe('fetchChartForHost — env source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
  })

  test('routes to /api/v1/charts/:name when host not found (undefined hostId)', async () => {
    const body = { data: [{ x: 1 }], metadata: { total: 1 } }
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(body))

    const result = await fetchChartForHost<{ x: number }[]>({
      chartName: 'my-chart',
      hostId: undefined,
      hosts: [],
    })

    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toBe('/api/v1/charts/my-chart')
    expect(result.data).toEqual([{ x: 1 }])
    expect(result.metadata).toEqual({ total: 1 })
  })

  test('routes to /api/v1/charts/:name for env source host', async () => {
    const hosts = [makeEnvHost(0)]
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({ chartName: 'events', hostId: 0, hosts })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('/api/v1/charts/events')
  })

  test('appends hostId query param', async () => {
    const hosts = [makeEnvHost(3)]
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({ chartName: 'events', hostId: 3, hosts })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('hostId=3')
  })

  test('appends interval query param when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({
      chartName: 'events',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      interval: '5m',
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('interval=5m')
  })

  test('appends lastHours query param when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({
      chartName: 'events',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      lastHours: 24,
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('lastHours=24')
  })

  test('appends JSON-serialized params query param when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({
      chartName: 'events',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      params: { foo: 'bar', count: 10 },
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('params=')
    expect(url).toContain(
      encodeURIComponent(JSON.stringify({ foo: 'bar', count: 10 }))
    )
  })

  test('appends timezone query param when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({
      chartName: 'events',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      timezone: 'UTC',
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('timezone=UTC')
  })

  test('omits query string when no optional params provided and hostId undefined', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchChartForHost({ chartName: 'events', hosts: [] })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toBe('/api/v1/charts/events')
    expect(url).not.toContain('?')
  })

  test('calls throwIfNotOk on the response', async () => {
    const resp = makeOkResponse({ data: [] })
    mockApiFetch.mockResolvedValueOnce(resp)

    await fetchChartForHost({ chartName: 'events', hosts: [] })

    expect(mockThrowIfNotOk).toHaveBeenCalledTimes(1)
    expect(mockThrowIfNotOk.mock.calls[0]?.[0]).toBe(resp)
    expect(mockThrowIfNotOk.mock.calls[0]?.[1]).toBe(
      'Failed to fetch chart data'
    )
  })

  test('propagates throwIfNotOk error', async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(500, {}))
    mockThrowIfNotOk.mockRejectedValueOnce(new Error('server error'))

    await expect(
      fetchChartForHost({ chartName: 'events', hosts: [] })
    ).rejects.toThrow('server error')
  })
})

// ---------------------------------------------------------------------------
// fetchChartForHost — database host routing
// ---------------------------------------------------------------------------

describe('fetchChartForHost — database source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
  })

  test('POSTs to /api/v1/user-connections/charts/:name for database host', async () => {
    const hosts = [makeDatabaseHost(2, 'conn-abc')]
    const responseBody = {
      success: true,
      data: [{ y: 42 }],
      metadata: { rows: 1 },
    }
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(responseBody))

    const result = await fetchChartForHost<{ y: number }[]>({
      chartName: 'disk-usage',
      hostId: 2,
      hosts,
    })

    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockApiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/user-connections/charts/disk-usage')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const reqBody = JSON.parse(init.body as string)
    expect(reqBody.connectionId).toBe('conn-abc')
    expect(result.data).toEqual([{ y: 42 }])
    expect(result.metadata).toEqual({ rows: 1 })
  })

  test('includes interval, lastHours, params, timezone in POST body', async () => {
    const hosts = [makeDatabaseHost(2, 'conn-abc')]
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: [] })
    )

    await fetchChartForHost({
      chartName: 'disk-usage',
      hostId: 2,
      hosts,
      interval: '10m',
      lastHours: 6,
      params: { table: 't1' },
      timezone: 'Asia/Ho_Chi_Minh',
    })

    const reqBody = JSON.parse(
      (mockApiFetch.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(reqBody.interval).toBe('10m')
    expect(reqBody.lastHours).toBe(6)
    expect(reqBody.params).toEqual({ table: 't1' })
    expect(reqBody.timezone).toBe('Asia/Ho_Chi_Minh')
  })

  test('falls through to error when database host has no connectionId', async () => {
    // A database host without a connectionId skips the database branch and hits the final throw
    const hostWithoutConnectionId: MergedHostInfo = {
      id: 5,
      name: 'broken',
      host: 'http://ch',
      user: 'default',
      source: 'database',
      engine: 'clickhouse',
      // connectionId intentionally omitted
    }

    await expect(
      fetchChartForHost({
        chartName: 'events',
        hostId: 5,
        hosts: [hostWithoutConnectionId],
      })
    ).rejects.toThrow('No connection available for the selected host')
  })
})

// ---------------------------------------------------------------------------
// fetchChartForHost — browser host routing
// ---------------------------------------------------------------------------

describe('fetchChartForHost — browser source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
    mockGetSessionToken.mockClear()
  })

  test('POSTs to /api/v1/browser-connections/charts/:name for browser host', async () => {
    const hosts = [makeBrowserHost(-1)]
    const browserConnection = makeBrowserConnection('bc-uuid', -1)
    const responseBody = { success: true, data: [{ z: 7 }] }
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(responseBody))

    const result = await fetchChartForHost<{ z: number }[]>({
      chartName: 'query-count',
      hostId: -1,
      hosts,
      browserConnection,
    })

    expect(mockGetSessionToken).toHaveBeenCalledTimes(1)
    expect(mockGetSessionToken.mock.calls[0]?.[0]).toBe(browserConnection)

    const [url, init] = mockApiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/browser-connections/charts/query-count')
    expect(init.method).toBe('POST')
    const reqBody = JSON.parse(init.body as string)
    expect(reqBody.sessionToken).toBe('mock-session-token')
    expect(result.data).toEqual([{ z: 7 }])
  })

  test('includes interval, lastHours, params, timezone in browser POST body', async () => {
    const hosts = [makeBrowserHost(-1)]
    const browserConnection = makeBrowserConnection('bc-uuid', -1)
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: [] })
    )

    await fetchChartForHost({
      chartName: 'query-count',
      hostId: -1,
      hosts,
      browserConnection,
      interval: '1h',
      lastHours: 12,
      params: { db: 'default' },
      timezone: 'UTC',
    })

    const reqBody = JSON.parse(
      (mockApiFetch.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(reqBody.interval).toBe('1h')
    expect(reqBody.lastHours).toBe(12)
    expect(reqBody.params).toEqual({ db: 'default' })
    expect(reqBody.timezone).toBe('UTC')
  })

  test('throws when browser host found but no browserConnection provided', async () => {
    const hosts = [makeBrowserHost(-1)]

    await expect(
      fetchChartForHost({
        chartName: 'query-count',
        hostId: -1,
        hosts,
        browserConnection: null, // explicitly null
      })
    ).rejects.toThrow('No connection available for the selected host')
  })

  test('throws when browser host found and browserConnection is undefined', async () => {
    const hosts = [makeBrowserHost(-1)]

    await expect(
      fetchChartForHost({
        chartName: 'query-count',
        hostId: -1,
        hosts,
        // browserConnection not provided
      })
    ).rejects.toThrow('No connection available for the selected host')
  })
})

// ---------------------------------------------------------------------------
// fetchTableForHost — env host routing
// ---------------------------------------------------------------------------

describe('fetchTableForHost — env source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
  })

  test('GETs /api/v1/tables/:name when host not found', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [{ a: 1 }] }))

    const result = await fetchTableForHost<{ a: number }>({
      queryConfigName: 'running-queries',
      hostId: undefined,
      hosts: [],
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toBe('/api/v1/tables/running-queries')
    expect(result.data).toEqual([{ a: 1 }])
  })

  test('GETs /api/v1/tables/:name for env source host', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({
      queryConfigName: 'tables',
      hostId: 0,
      hosts: [makeEnvHost(0)],
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('/api/v1/tables/tables')
  })

  test('appends hostId to query params', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({
      queryConfigName: 'tables',
      hostId: 1,
      hosts: [makeEnvHost(1)],
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('hostId=1')
  })

  test('appends timezone to query params when provided', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({
      queryConfigName: 'tables',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      timezone: 'Europe/Berlin',
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('timezone=Europe%2FBerlin')
  })

  test('appends searchParams as query string entries', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({
      queryConfigName: 'tables',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      searchParams: { page: 1, size: 50, filter: 'active' },
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('page=1')
    expect(url).toContain('size=50')
    expect(url).toContain('filter=active')
  })

  test('skips undefined/null/empty string searchParams values', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({
      queryConfigName: 'tables',
      hostId: 0,
      hosts: [makeEnvHost(0)],
      searchParams: { page: 1, filter: undefined, name: '' },
    })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('page=1')
    expect(url).not.toContain('filter=')
    expect(url).not.toContain('name=')
  })

  test('omits query string when no optional params', async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }))

    await fetchTableForHost({ queryConfigName: 'tables', hosts: [] })

    const url = mockApiFetch.mock.calls[0]?.[0] as string
    expect(url).toBe('/api/v1/tables/tables')
    expect(url).not.toContain('?')
  })

  test('calls throwIfNotOk with correct fallback message', async () => {
    const resp = makeOkResponse({ data: [] })
    mockApiFetch.mockResolvedValueOnce(resp)

    await fetchTableForHost({ queryConfigName: 'tables', hosts: [] })

    expect(mockThrowIfNotOk.mock.calls[0]?.[1]).toBe(
      'Failed to fetch table data'
    )
  })

  test('propagates throwIfNotOk error', async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(503, {}))
    mockThrowIfNotOk.mockRejectedValueOnce(new Error('upstream down'))

    await expect(
      fetchTableForHost({ queryConfigName: 'tables', hosts: [] })
    ).rejects.toThrow('upstream down')
  })
})

// ---------------------------------------------------------------------------
// fetchTableForHost — database host routing
// ---------------------------------------------------------------------------

describe('fetchTableForHost — database source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
  })

  test('POSTs to /api/v1/user-connections/tables/:name for database host', async () => {
    const hosts = [makeDatabaseHost(2, 'conn-xyz')]
    const responseBody = {
      success: true,
      data: [{ row: 1 }],
      metadata: { count: 1 },
    }
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(responseBody))

    const result = await fetchTableForHost<{ row: number }>({
      queryConfigName: 'merges',
      hostId: 2,
      hosts,
    })

    const [url, init] = mockApiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/user-connections/tables/merges')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.connectionId).toBe('conn-xyz')
    expect(result.data).toEqual([{ row: 1 }])
    expect(result.metadata).toEqual({ count: 1 })
  })

  test('passes flattened searchParams to POST body, skipping empty/undefined values', async () => {
    const hosts = [makeDatabaseHost(2, 'conn-xyz')]
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: [] })
    )

    await fetchTableForHost({
      queryConfigName: 'merges',
      hostId: 2,
      hosts,
      searchParams: {
        page: 2,
        size: 25,
        active: true,
        skip: undefined,
        empty: '',
      },
      timezone: 'UTC',
    })

    const body = JSON.parse(
      (mockApiFetch.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.searchParams).toEqual({ page: 2, size: 25, active: true })
    expect(body.searchParams.skip).toBeUndefined()
    expect(body.searchParams.empty).toBeUndefined()
    expect(body.timezone).toBe('UTC')
  })

  test('passes empty searchParams object when none provided', async () => {
    const hosts = [makeDatabaseHost(2, 'conn-xyz')]
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: [] })
    )

    await fetchTableForHost({ queryConfigName: 'merges', hostId: 2, hosts })

    const body = JSON.parse(
      (mockApiFetch.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.searchParams).toEqual({})
  })

  test('throws when database host has no connectionId', async () => {
    const hostWithoutId: MergedHostInfo = {
      id: 7,
      name: 'no-conn',
      host: 'http://ch',
      user: 'default',
      source: 'database',
      engine: 'clickhouse',
    }

    await expect(
      fetchTableForHost({
        queryConfigName: 'merges',
        hostId: 7,
        hosts: [hostWithoutId],
      })
    ).rejects.toThrow('No connection available for the selected host')
  })
})

// ---------------------------------------------------------------------------
// fetchTableForHost — browser host routing
// ---------------------------------------------------------------------------

describe('fetchTableForHost — browser source', () => {
  beforeEach(() => {
    mockApiFetch.mockClear()
    mockThrowIfNotOk.mockClear()
    mockGetSessionToken.mockClear()
  })

  test('POSTs to /api/v1/browser-connections/tables/:name for browser host', async () => {
    const hosts = [makeBrowserHost(-2)]
    const browserConnection = makeBrowserConnection('bc-uuid-2', -2)
    const responseBody = { success: true, data: [{ tbl: 'x' }] }
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(responseBody))

    const result = await fetchTableForHost<{ tbl: string }>({
      queryConfigName: 'slow-queries',
      hostId: -2,
      hosts,
      browserConnection,
    })

    expect(mockGetSessionToken).toHaveBeenCalledTimes(1)
    expect(mockGetSessionToken.mock.calls[0]?.[0]).toBe(browserConnection)

    const [url, init] = mockApiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/browser-connections/tables/slow-queries')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.sessionToken).toBe('mock-session-token')
    expect(result.data).toEqual([{ tbl: 'x' }])
  })

  test('passes flattened searchParams and timezone in browser POST body', async () => {
    const hosts = [makeBrowserHost(-2)]
    const browserConnection = makeBrowserConnection('bc-uuid-2', -2)
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ success: true, data: [] })
    )

    await fetchTableForHost({
      queryConfigName: 'slow-queries',
      hostId: -2,
      hosts,
      browserConnection,
      searchParams: { limit: 100, active: false },
      timezone: 'America/New_York',
    })

    const body = JSON.parse(
      (mockApiFetch.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.searchParams).toEqual({ limit: 100, active: false })
    expect(body.timezone).toBe('America/New_York')
  })

  test('throws when browser host found but browserConnection is null', async () => {
    const hosts = [makeBrowserHost(-1)]

    await expect(
      fetchTableForHost({
        queryConfigName: 'slow-queries',
        hostId: -1,
        hosts,
        browserConnection: null,
      })
    ).rejects.toThrow('No connection available for the selected host')
  })

  test('throws when browser host found but browserConnection is undefined', async () => {
    const hosts = [makeBrowserHost(-1)]

    await expect(
      fetchTableForHost({
        queryConfigName: 'slow-queries',
        hostId: -1,
        hosts,
      })
    ).rejects.toThrow('No connection available for the selected host')
  })
})
