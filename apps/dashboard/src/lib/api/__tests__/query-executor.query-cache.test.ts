/**
 * #2182 — verifies the ClickHouse query-cache settings are applied on the
 * read-only executor paths (executeTableConfig / executeChartQuery /
 * executeMultiChartQuery) and can be opted out per query-config, using a
 * fully mocked ClickHouse client (no network).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const mockFetchData = mock(
  async (args: { clickhouse_settings?: Record<string, unknown> }) => ({
    data: [],
    metadata: { queryId: 'q', duration: 0, rows: 0, host: 'h' },
    error: undefined,
    __settings: args.clickhouse_settings,
  })
)

const mockFetchJsonEachRow = mock(
  async (args: { clickhouse_settings?: Record<string, unknown> }) => ({
    data: null,
    dataJson: '[]',
    metadata: { queryId: 'q', duration: 0, rows: 0, host: 'h' },
    error: undefined,
    __settings: args.clickhouse_settings,
  })
)

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
  fetchJsonEachRowAsNormalizedJson: mockFetchJsonEachRow,
  getClient: async () => ({ query: async () => ({}) }),
}))

// Modern ClickHouse (24.8) so query-cache settings are eligible. Spread the
// real module so `meetsMinVersion` (used by query-cache-settings.ts) still
// works.
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
  selectVersionedSql: (sql: unknown) =>
    Array.isArray(sql) ? sql[sql.length - 1].sql : sql,
}))

const { executeChartQuery, executeMultiChartQuery, executeTableConfig } =
  await import('@/lib/api/query-executor')

describe('query-executor ClickHouse query-cache wiring (#2182)', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
    mockFetchJsonEachRow.mockClear()
  })

  test('executeTableConfig applies use_query_cache with the config refreshInterval as TTL', async () => {
    await executeTableConfig(
      { name: 't', sql: 'SELECT 1', columns: [], refreshInterval: 15000 },
      0,
      undefined
    )

    const settings = mockFetchData.mock.calls[0]?.[0]?.clickhouse_settings as
      | Record<string, unknown>
      | undefined
    expect(settings?.use_query_cache).toBe(1)
    expect(settings?.query_cache_ttl).toBe(15)
    expect(settings?.query_cache_nondeterministic_function_handling).toBe(
      'save'
    )
  })

  test('executeTableConfig respects disableQueryCache', async () => {
    await executeTableConfig(
      { name: 't', sql: 'SELECT 1', columns: [], disableQueryCache: true },
      0,
      undefined
    )

    const settings = mockFetchData.mock.calls[0]?.[0]?.clickhouse_settings as
      | Record<string, unknown>
      | undefined
    expect(settings?.use_query_cache).toBeUndefined()
  })

  test('a config clickhouseSettings override still wins over the cache default', async () => {
    await executeTableConfig(
      {
        name: 't',
        sql: 'SELECT 1',
        columns: [],
        clickhouseSettings: { use_query_cache: 0 },
      },
      0,
      undefined
    )

    const settings = mockFetchData.mock.calls[0]?.[0]?.clickhouse_settings as
      | Record<string, unknown>
      | undefined
    expect(settings?.use_query_cache).toBe(0)
  })

  test('executeChartQuery applies use_query_cache using the passed ttlSeconds', async () => {
    await executeChartQuery('c', 'SELECT 1', 0, undefined, { ttlSeconds: 10 })

    const settings = mockFetchJsonEachRow.mock.calls[0]?.[0]
      ?.clickhouse_settings as Record<string, unknown> | undefined
    expect(settings?.use_query_cache).toBe(1)
    expect(settings?.query_cache_ttl).toBe(10)
  })

  test('executeChartQuery skips the cache when disableQueryCache is set', async () => {
    await executeChartQuery('c', 'SELECT 1', 0, undefined, {
      ttlSeconds: 10,
      disableQueryCache: true,
    })

    const settings = mockFetchJsonEachRow.mock.calls[0]?.[0]
      ?.clickhouse_settings as Record<string, unknown> | undefined
    expect(settings?.use_query_cache).toBeUndefined()
  })

  test('executeChartQuery skips the cache when ttlSeconds is omitted', async () => {
    await executeChartQuery('c', 'SELECT 1', 0, undefined)

    const settings = mockFetchJsonEachRow.mock.calls[0]?.[0]
      ?.clickhouse_settings as Record<string, unknown> | undefined
    expect(settings?.use_query_cache).toBeUndefined()
  })

  test('executeMultiChartQuery applies the same settings to every sub-query', async () => {
    await executeMultiChartQuery(
      [
        { key: 'a', query: 'SELECT 1' },
        { key: 'b', query: 'SELECT 2' },
      ],
      0,
      { ttlSeconds: 20 }
    )

    expect(mockFetchJsonEachRow.mock.calls.length).toBe(2)
    for (const call of mockFetchJsonEachRow.mock.calls) {
      const settings = call[0]?.clickhouse_settings as
        | Record<string, unknown>
        | undefined
      expect(settings?.use_query_cache).toBe(1)
      expect(settings?.query_cache_ttl).toBe(20)
    }
  })
})
