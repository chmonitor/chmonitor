import { describe, expect, test } from 'bun:test'
import { queryInsightsCharts } from '@/lib/api/charts/query-insights-charts'

const defaultParams = { interval: 'toStartOfHour' as const, lastHours: 24 }

describe('queryInsightsCharts', () => {
  const entries = Object.entries(queryInsightsCharts)

  test('map is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  test('known chart names are present', () => {
    const names = Object.keys(queryInsightsCharts)
    expect(names).toContain('query-insights-qps')
    expect(names).toContain('query-insights-latency')
    expect(names).toContain('query-insights-operations')
    expect(names).toContain('query-insights-rows')
    expect(names).toContain('query-insights-cache-hit-ratio')
    expect(names).toContain('query-insights-errors')
  })

  test.each(
    entries
  )('"%s" builder returns valid, version-aware query result', (_name, builder) => {
    const result = builder(defaultParams) as any

    expect(result).toHaveProperty('query')
    expect(typeof result.query).toBe('string')
    expect(result.query.length).toBeGreaterThan(0)
    expect(result.query).toMatch(/SELECT/i)
    expect(result.query).toMatch(/query_log/)

    // Version-aware sql: [{ since, sql }] array per repo convention.
    expect(Array.isArray(result.sql)).toBe(true)
    expect(result.sql.length).toBeGreaterThan(0)
    for (const variant of result.sql) {
      expect(typeof variant.since).toBe('string')
      expect(typeof variant.sql).toBe('string')
      expect(variant.sql).toMatch(/SELECT/i)
    }
  })

  test('errors tile filters on exception_code != 0', () => {
    const result = queryInsightsCharts['query-insights-errors'](
      defaultParams
    ) as any
    expect(result.query).toMatch(/exception_code\s*!=\s*0/)
  })

  test('cache hit ratio tile reads MarkCache/UncompressedCache ProfileEvents', () => {
    const result = queryInsightsCharts['query-insights-cache-hit-ratio'](
      defaultParams
    ) as any
    expect(result.query).toMatch(/MarkCacheHits/)
    expect(result.query).toMatch(/UncompressedCacheHits/)
  })

  test('operations tile groups by query_kind', () => {
    const result = queryInsightsCharts['query-insights-operations'](
      defaultParams
    ) as any
    expect(result.query).toMatch(/GROUP BY query_kind/)
  })

  test('latency tile includes mean and p50/p95/p99', () => {
    const result = queryInsightsCharts['query-insights-latency'](
      defaultParams
    ) as any
    expect(result.query).toMatch(/avg\(query_duration_ms\)/)
    expect(result.query).toMatch(/quantile\(0\.50\)/)
    expect(result.query).toMatch(/quantile\(0\.95\)/)
    expect(result.query).toMatch(/quantile\(0\.99\)/)
  })
})
