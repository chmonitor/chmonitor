import { describe, expect, test } from 'bun:test'
import { queryCharts } from '@/lib/api/charts/query-charts'
import { CHART_QUERY_SETTINGS } from '@/lib/api/charts/types'

// Never carried a timeout before #3684; left on the client default.
const NO_CHART_TIMEOUT = new Set([
  'query-cache',
  'slow-query-regressions',
  'mv-staleness',
])

describe('queryCharts', () => {
  const entries = Object.entries(queryCharts)

  test('map is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  // #3684: a `SETTINGS` clause in the SQL text is refused under read-only
  // mode before the client can normalize the request, so the Worker timeout
  // travels as a client setting instead.
  test('no builder writes the timeout into its SQL text', () => {
    for (const [, builder] of entries) {
      const result = builder({}) as { query?: string; sql?: { sql: string }[] }
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
      if (NO_CHART_TIMEOUT.has(name)) continue
      const result = builder({}) as { clickhouseSettings?: unknown }
      expect({ name, settings: result.clickhouseSettings }).toEqual({
        name,
        settings: CHART_QUERY_SETTINGS,
      })
    }
  })

  describe.each(entries)('chart "%s"', (name, builder) => {
    test('returns an object with a query property', () => {
      const result = builder({})
      expect(result).toBeDefined()
      expect(result).toHaveProperty('query')
    })

    test('query is a non-empty string containing SELECT', () => {
      const result = builder({})
      if ('query' in result) {
        expect(typeof result.query).toBe('string')
        expect(result.query.length).toBeGreaterThan(0)
        expect(result.query).toMatch(/SELECT/i)
      }
    })

    if (name === 'query-count' || name === 'failed-query-count') {
      test('scans query_log once and still returns the kind breakdown', () => {
        const result = builder({})
        if (!('query' in result)) return
        const scans =
          result.query.match(/merge\('system', '\^query_log'\)/g) ?? []
        expect(scans).toHaveLength(1)
        expect(result.query).toContain('AS query_count')
        expect(result.query).toContain('AS breakdown')
      })
    }

    if (name === 'mv-staleness') {
      test('marks a failed refresh by exception or retry, not status Error/Failed', () => {
        const result = builder({})
        if (!('query' in result)) return
        expect(result.query).toContain("exception != '' OR retry > 0")
        expect(result.query).not.toContain("status IN ('Error', 'Failed')")
      })
    }

    if (name === 'query-count-today') {
      test('filters today with event_time so query_log can prune partitions', () => {
        const result = builder({})
        if ('query' in result) {
          expect(result.query).toContain('event_time >= toStartOfDay(now())')
          expect(result.query).not.toContain('toDate(event_time)')
        }
      })
    }

    if (name === 'query-cache-usage') {
      test('has VersionedSql array in sql property', () => {
        const result = builder({})
        if ('sql' in result && result.sql) {
          expect(Array.isArray(result.sql)).toBe(true)
          expect(result.sql.length).toBeGreaterThan(0)
          for (const entry of result.sql) {
            expect(entry).toHaveProperty('since')
            expect(entry).toHaveProperty('sql')
            expect(typeof entry.since).toBe('string')
            expect(typeof entry.sql).toBe('string')
            expect(entry.sql).toMatch(/SELECT/i)
          }
        }
      })
    }
  })
})
