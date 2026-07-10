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

  // ---------------------------------------------------------------------------
  // SECURITY: percentile SQL-injection guard (issue #2464)
  //
  // `percentile` is spliced into raw SQL as the quantile level (`0.${p}`) rather
  // than bound, and the endpoint is unauthenticated on the default self-hosted
  // posture. Every chart that reads `percentile` must funnel it through the
  // numeric allowlist so a hostile value can never reach ClickHouse.
  // ---------------------------------------------------------------------------
  describe('percentile injection guard', () => {
    // The 8 call sites that read `params.percentile`.
    const percentileCharts = [
      'insight-largest-scan',
      'insight-fastest-scan',
      'insight-longest-query',
      'insight-avg-duration',
      'insight-total-queries',
      'insight-total-scanned',
      'insight-total-rows-read',
      'insight-peak-memory',
    ] as const

    const maliciousValues = [
      '99) FROM system.users--',
      '50)),arbitrary--',
      '1)) UNION SELECT * FROM system.users--',
      '99; DROP TABLE t',
      '0.99',
      'abc',
      '',
      '-1',
      '101',
      '999',
      '1e2',
      ' 99',
      '99 ',
    ]

    // bun's `.each` spreads each tuple row into the callback args, so the
    // callback receives the chart name directly (not a tuple to destructure).
    // The 1-tuple mapping is only there to satisfy tsc's `.each` overloads,
    // which reject a readonly array of bare strings.
    describe.each(
      percentileCharts.map((c) => [c] as const)
    )('chart "%s"', (chartName) => {
      test.each(
        maliciousValues
      )('rejects malicious percentile %p (no injected fragment, safe fallback)', (percentile) => {
        const result = insightCharts[chartName]({
          lastHours: 24,
          params: { percentile },
        })
        if (!('query' in result)) throw new Error('expected query')
        const sql = result.query
        // No hostile fragment survives into the SQL.
        expect(sql).not.toContain('system.users')
        expect(sql).not.toContain('UNION')
        expect(sql).not.toContain('DROP')
        expect(sql).not.toContain('--')
        // The quantile level, when present, is always a bare `0.<int>`.
        const levels = sql.match(/quantileTDigest\(([^)]*)\)/g) ?? []
        for (const level of levels) {
          expect(level).toMatch(/^quantileTDigest\(0\.\d{1,3}\)$/)
        }
        // Injection payloads fall back to the default p99.
        if (sql.includes('quantileTDigest')) {
          expect(sql).toContain('quantileTDigest(0.99)')
        }
      })

      test('accepts the legitimate UI values 95/99/100', () => {
        for (const percentile of ['95', '99', '100']) {
          const result = insightCharts[chartName]({
            lastHours: 24,
            params: { percentile },
          })
          if (!('query' in result)) throw new Error('expected query')
          const sql = result.query
          if (percentile === '100') {
            // p100 uses max() / drops the duration filter — no quantile level.
            expect(sql).not.toContain('quantileTDigest(0.100)')
          } else {
            expect(sql).toContain(`quantileTDigest(0.${percentile})`)
          }
        }
      })
    })
  })
})
