import { describe, expect, test } from 'bun:test'
import { queryCharts } from '@/lib/api/charts/query-charts'

describe('queryCharts', () => {
  const entries = Object.entries(queryCharts)

  test('map is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
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
