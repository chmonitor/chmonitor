import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SANITIZED_MESSAGES } from '@/lib/api/error-handler/sanitize-error'

// Mutable so the cloud demo-hidden branch (hostId=0 for a signed-in cloud
// principal) is reachable from the last test below. Mirrors the reference
// pattern in routes/api/v1/__tests__/host-status.cloud-demo-host-guard.test.ts.
let cloudMode = false
let signedIn = false

// Mock 'cloudflare:workers' because it is imported in index.ts
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

const mockFetchData = mock(
  async (_args: {
    query: string
    clickhouse_settings?: Record<string, unknown>
  }): Promise<{
    data: unknown[] | null
    error: unknown
  }> => ({ data: [], error: null })
)

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

// Fixed, modern version so buildQueryCacheSettings applies the query-cache
// settings deterministically (#2182) — avoids a real network call from the
// route's getClickHouseVersion() lookup. Spread the real module so
// `meetsMinVersion` (used by query-cache-settings.ts) still works.
const realClickHouseVersion = await import(
  '@chm/clickhouse-client/clickhouse-version'
)
mock.module('@chm/clickhouse-client/clickhouse-version', () => ({
  ...realClickHouseVersion,
  getClickHouseVersion: async () => ({
    major: 24,
    minor: 8,
    patch: 0,
    raw: '24.8.0',
  }),
}))

describe('menu-counts API GET handler', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
    cloudMode = false
    signedIn = false
  })

  test('constructs combined query and executes it', async () => {
    const { handler } = await import('../index')

    // Mock system.tables check to return existing tables
    // Mock the combined query to return some counts
    mockFetchData.mockImplementation(async ({ query }) => {
      if (query.includes('database, name')) {
        return {
          data: [
            { database: 'system', name: 'clusters' },
            { database: 'system', name: 'backup_log' },
          ],
          error: null,
        }
      }
      if (query.includes('AS')) {
        return {
          data: [
            {
              'tables-explorer': 5,
              'tables-overview': 10,
              clusters: 2,
              backups: 1,
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const request = new Request('http://localhost/api/v1/menu-counts?hostId=0')
    const response = await handler(request)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: { counts: Record<string, number | null> }
    }
    expect(body.data).toHaveProperty('counts')
    expect(body.data.counts['tables-explorer']).toBe(5)
    expect(body.data.counts['tables-overview']).toBe(10)
    expect(body.data.counts.clusters).toBe(2)
    expect(body.data.counts.backups).toBe(1)
    // Optional table that doesn't exist should be null
    expect(body.data.counts['distributed-ddl-queue']).toBeNull()

    // Assert that exactly 2 queries were executed: system.tables check and the combined query
    expect(mockFetchData.mock.calls.length).toBe(2)
    expect(mockFetchData.mock.calls[0]?.[0]?.query).toContain('database, name')
    expect(mockFetchData.mock.calls[1]?.[0]?.query).toContain('AS')

    // #2182: the combined (batched) count query is a read-only GET path —
    // it must opt into the ClickHouse query cache, bounded by a TTL.
    const combinedSettings =
      mockFetchData.mock.calls[1]?.[0]?.clickhouse_settings
    expect(combinedSettings?.use_query_cache).toBe(1)
    expect(combinedSettings?.query_cache_ttl).toBe(60)
    expect(
      combinedSettings?.query_cache_nondeterministic_function_handling
    ).toBe('save')
  })

  test('falls back to sequential loop when combined query fails', async () => {
    const { handler } = await import('../index')

    mockFetchData.mockImplementation(async ({ query }) => {
      if (query.includes('database, name')) {
        return {
          data: [{ database: 'system', name: 'clusters' }],
          error: null,
        }
      }
      if (query.includes('AS')) {
        // Combined query fails
        return {
          data: null,
          error: { message: 'Syntax error or something' },
        }
      }
      // Single queries from resolveCount
      return {
        data: [{ count: 42 }],
        error: null,
      }
    })

    const request = new Request('http://localhost/api/v1/menu-counts?hostId=0')
    const response = await handler(request)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: { counts: Record<string, number | null> }
    }
    expect(body.data.counts['tables-explorer']).toBe(42)

    // Verify it executed more queries because of fallback loop
    expect(mockFetchData.mock.calls.length).toBeGreaterThan(2)
  })

  // #3487: a host that is not answering resolves EVERY key to `null`, which
  // was indistinguishable from "this deployment has none of the optional
  // tables" and shipped `200 {success:true}` — a dashboard with no numbers and
  // no error.
  test('every queried count unresolved answers non-2xx, not 200 with nulls', async () => {
    const { handler } = await import('../index')

    // The raw ClickHouse error carries internal detail that must never reach
    // the client (#2555) — hence the exact sanitized bucket below.
    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: {
        type: 'network_error',
        message:
          'Code: 210. DB::NetException: Connection refused (clickhouse-demo.internal:8123)',
      },
    }))

    const request = new Request('http://localhost/api/v1/menu-counts?hostId=0')
    const response = await handler(request)

    expect(response.status).not.toBe(200)
    expect(response.status).toBe(500)

    const body = (await response.json()) as {
      success: boolean
      error?: { type: string; message: string }
    }
    expect(body.success).toBe(false)
    expect(body.error?.type).toBe('network_error')
    expect(body.error?.message).toBe(SANITIZED_MESSAGES.GENERIC)
    // The raw error text (host, port, code) must not be echoed.
    expect(JSON.stringify(body)).not.toContain('clickhouse-demo.internal')
  })

  // The retained half of the same rule: ONE unavailable key is still a 200.
  // Fails if the #3487 check is over-broadened to "any key null errors".
  test('keeps 200 when one optional key is null and the rest resolve', async () => {
    const { handler } = await import('../index')

    mockFetchData.mockImplementation(async ({ query }) => {
      if (query.includes('database, name')) {
        return { data: [], error: null }
      }
      if (query.includes('AS')) {
        // Combined query fails, so the fallback loop runs per key.
        return {
          data: null,
          error: { type: 'query_error', message: 'Syntax error' },
        }
      }
      // One optional key's own query fails; every other key resolves.
      if (query.includes('system.dictionaries')) {
        return {
          data: null,
          error: { type: 'table_not_found', message: 'Table not found' },
        }
      }
      return { data: [{ count: 42 }], error: null }
    })

    const request = new Request('http://localhost/api/v1/menu-counts?hostId=0')
    const response = await handler(request)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: { counts: Record<string, number | null> }
    }
    expect(body.data.counts.dictionaries).toBeNull()
    expect(body.data.counts['tables-explorer']).toBe(42)
    expect(body.data.counts.merges).toBe(42)
  })

  // The demo-hiding branch answers 200 with an empty `counts` map and an
  // `unavailable` block (#2172 / #2488). That is a deliberate "not available"
  // answer, not a host failure — the new check must not read it as one.
  test('cloud demo-hidden branch still answers 200 with its unavailable shape', async () => {
    const { handler } = await import('../index')
    cloudMode = true
    signedIn = true

    // No ClickHouse query may run: the branch returns before resolving.
    mockFetchData.mockImplementation(async () => ({ data: [], error: null }))

    const request = new Request('http://localhost/api/v1/menu-counts?hostId=0')
    const response = await handler(request)
    expect(response.status).toBe(200)
    expect(mockFetchData).not.toHaveBeenCalled()

    const body = (await response.json()) as {
      success: boolean
      data: { counts: Record<string, number | null> }
      metadata: { unavailable: { reason: string; message: string } }
    }
    expect(body.success).toBe(true)
    expect(body.data.counts).toEqual({})
    expect(body.metadata.unavailable.reason).toBe('demo_hidden')
  })
})
