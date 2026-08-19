/**
 * WHY: stats-grid used to fire ~20 independent chart requests. The shipped
 * grouping executor must return per-name keys for the frozen insights-stats
 * list and reject unknown grouping ids — otherwise a free-form batch would
 * fragment the cache key and skip rate-limit accounting.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const mockFetchJsonEachRow = mock(async (args: { query?: string }) => ({
  data: null,
  dataJson: JSON.stringify([{ query: args.query?.slice(0, 24) ?? '' }]),
  metadata: { queryId: 'q', duration: 1, rows: 1, host: 'h' },
  error: undefined,
}))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({
    data: [],
    metadata: { queryId: 'q', duration: 0, rows: 0, host: 'h' },
    error: undefined,
  }),
  fetchJsonEachRowAsNormalizedJson: mockFetchJsonEachRow,
  getClient: async () => ({ query: async () => ({}) }),
}))

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

const {
  CHART_GROUPINGS,
  chartGroupingIdForName,
  executeChartGrouping,
  groupingCacheControl,
  INSIGHTS_STATS_GROUPING,
  isChartGroupingId,
  isKnownChartGrouping,
  UnknownChartGroupingError,
} = await import('@/lib/api/chart-batch')

describe('executeChartGrouping', () => {
  beforeEach(() => {
    mockFetchJsonEachRow.mockClear()
  })

  test('runs the frozen insights-stats grouping and returns per-name keys', async () => {
    const result = await executeChartGrouping('insights-stats', 0, {
      lastHours: 24,
      params: { percentile: '99' },
    })

    expect(Object.keys(result).sort()).toEqual(
      [...INSIGHTS_STATS_GROUPING].slice().sort()
    )
    expect(INSIGHTS_STATS_GROUPING).toHaveLength(20)
    expect(mockFetchJsonEachRow.mock.calls.length).toBe(
      INSIGHTS_STATS_GROUPING.length
    )

    for (const name of INSIGHTS_STATS_GROUPING) {
      expect(result[name]).toBeDefined()
      expect(result[name]?.dataJson).toBeTruthy()
      expect(result[name]?.error).toBeUndefined()
    }
    expect(CHART_GROUPINGS['insights-stats']).toBe(INSIGHTS_STATS_GROUPING)
  })

  test('rejects an unknown grouping id', async () => {
    expect(isKnownChartGrouping('not-a-group')).toBe(false)
    expect(isChartGroupingId('insights-stats')).toBe(true)
    expect(isChartGroupingId('arbitrary-free-form')).toBe(false)
    expect(chartGroupingIdForName('insight-active-queries')).toBe(
      'insights-stats'
    )
    expect(chartGroupingIdForName('query-count')).toBeUndefined()

    let thrown: unknown
    try {
      await executeChartGrouping('not-a-group', 0)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(UnknownChartGroupingError)
    expect(
      (thrown as InstanceType<typeof UnknownChartGroupingError>).groupingId
    ).toBe('not-a-group')
  })

  test('Cache-Control uses the minimum s-maxage of grouping members', () => {
    // insights-stats mixes realtime (10s) and historical (120s) tiles.
    expect(groupingCacheControl(INSIGHTS_STATS_GROUPING)).toBe(
      'public, s-maxage=10, stale-while-revalidate=30'
    )
  })
})
