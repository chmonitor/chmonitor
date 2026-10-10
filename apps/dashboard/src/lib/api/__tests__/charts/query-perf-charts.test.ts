import { describe, expect, test } from 'bun:test'
import { queryPerfCharts } from '@/lib/api/charts/query-perf-charts'
import { CHART_QUERY_SETTINGS } from '@/lib/api/charts/types'

const defaultParams = { interval: 'toStartOfHour' as const, lastHours: 24 }

describe('queryPerfCharts', () => {
  const entries = Object.entries(queryPerfCharts)

  test('map is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  // #3684: a `SETTINGS` clause in the SQL text is refused under read-only
  // mode before the client can normalize the request, so the Worker timeout
  // travels as a client setting instead.
  test('no builder writes the timeout into its SQL text', () => {
    for (const [, builder] of entries) {
      const result = builder(defaultParams) as {
        query?: string
        sql?: { sql: string }[]
      }
      const texts = [
        result.query ?? '',
        ...(result.sql ?? []).map((v) => v.sql),
      ]
      for (const text of texts)
        expect(text).not.toMatch(/SETTINGS\s+max_execution_time/i)
    }
  })

  test('builders carry the shared chart timeout as a client setting', () => {
    for (const [name, builder] of entries) {
      const result = builder(defaultParams) as { clickhouseSettings?: unknown }
      expect({ name, settings: result.clickhouseSettings }).toEqual({
        name,
        settings: CHART_QUERY_SETTINGS,
      })
    }
  })

  test.each(
    entries
  )('"%s" builder returns valid query result', (_name, builder) => {
    const result = builder(defaultParams) as any

    // Must have a query property
    expect(result).toHaveProperty('query')
    expect(typeof result.query).toBe('string')
    expect(result.query.length).toBeGreaterThan(0)

    // Query must contain SELECT
    expect(result.query).toMatch(/SELECT/i)
  })

  test('known chart names are present', () => {
    const names = Object.keys(queryPerfCharts)
    expect(names).toContain('insert-performance')
    expect(names).toContain('top-query-fingerprints-perf')
    expect(names).toContain('query-duration-trend')
    expect(names).toContain('top-inserters')
  })

  test('queries reference expected system tables', () => {
    for (const [, builder] of entries) {
      const result = builder(defaultParams) as any
      // All query-perf charts query query_log
      expect(result.query).toMatch(/query_log/)
    }
  })
})
