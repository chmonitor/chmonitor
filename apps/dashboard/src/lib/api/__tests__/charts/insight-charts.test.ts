import { describe, expect, test } from 'bun:test'
import { insightCharts } from '@/lib/api/charts/insight-charts'

describe('insightCharts', () => {
  const entries = Object.entries(insightCharts)

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

    if (name === 'insight-detached-parts') {
      test('marks itself as optional with tableCheck', () => {
        const result = builder({})
        if ('optional' in result) {
          expect(result.optional).toBe(true)
          expect(result.tableCheck).toBe('system.detached_parts')
        }
      })
    }
  })

  test('time-filtered charts accept lastHours parameter', () => {
    const timeFilteredCharts = [
      'insight-largest-scan',
      'insight-fastest-scan',
      'insight-longest-query',
      'insight-query-summary',
    ] as const

    for (const chartName of timeFilteredCharts) {
      const builder = insightCharts[chartName]
      const result = builder({ lastHours: 48 })
      if ('query' in result) {
        expect(result.query).toContain('48')
      }
    }
  })

  test('largest-scan uses single-pass aggregate and valid time filter', () => {
    const result = insightCharts['insight-largest-scan']({
      lastHours: 24,
      params: { percentile: '99' },
    })
    expect('query' in result).toBe(true)
    if (!('query' in result)) return
    expect(result.query).toContain('quantileTDigest(0.99)(read_bytes)')
    expect(result.query).toContain('AND event_time >=')
    expect(result.query).toContain('read_bytes > 0')
    // Aggregate evaluated once in a subquery, not twice in the SELECT list.
    const matches = result.query.match(
      /quantileTDigest\(0\.99\)\(read_bytes\)/g
    )
    expect(matches?.length).toBe(1)
  })

  test('largest-scan p100 uses max()', () => {
    const result = insightCharts['insight-largest-scan']({
      lastHours: 24,
      params: { percentile: '100' },
    })
    if (!('query' in result)) throw new Error('expected query')
    expect(result.query).toContain('max(read_bytes)')
    expect(result.query).not.toContain('quantileTDigest')
  })

  test('total-queries percentile filter includes AND before time filter', () => {
    const result = insightCharts['insight-total-queries']({
      lastHours: 24,
      params: { percentile: '99' },
    })
    if (!('query' in result)) throw new Error('expected query')
    // Regression: missing AND produced invalid SQL like
    // "is_initial_query = 1 event_time >="
    expect(result.query).toMatch(/is_initial_query = 1\s+AND\s+event_time/)
    expect(result.query).not.toMatch(/is_initial_query = 1\s+event_time/)
  })
})
