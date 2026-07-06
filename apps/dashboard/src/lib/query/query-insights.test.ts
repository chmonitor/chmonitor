import { deriveQueryInsights } from './query-insights'
import { describe, expect, test } from 'bun:test'

describe('deriveQueryInsights', () => {
  test('flags an exception as critical and surfaces it first', () => {
    const out = deriveQueryInsights({
      query: 'SELECT 1',
      exception_code: 48,
      exception_text: 'ADASTRA: limit exceeded',
      query_duration: 0.1,
      read_rows: 0,
      result_rows: 0,
      memory_usage: 0,
    })
    expect(out[0].id).toBe('exception')
    expect(out[0].severity).toBe('critical')
  })

  test('no findings for a cheap, well-formed query', () => {
    const out = deriveQueryInsights({
      query: 'SELECT count() FROM t WHERE x = 1',
      query_duration: 0.05,
      read_rows: 1000,
      result_rows: 1,
      memory_usage: 5_000_000,
    })
    expect(out).toEqual([])
  })

  test('warns on slow (>=10s) and critical on very slow (>=60s)', () => {
    const slow = deriveQueryInsights({
      query: 'SELECT 1 WHERE 1',
      query_duration: 12,
      read_rows: 1,
      result_rows: 1,
      memory_usage: 0,
    })
    expect(slow.find((i) => i.id === 'duration-warn')?.severity).toBe('warning')

    const very = deriveQueryInsights({
      query: 'SELECT 1 WHERE 1',
      query_duration: 90,
      read_rows: 1,
      result_rows: 1,
      memory_usage: 0,
    })
    expect(very.find((i) => i.id === 'duration-critical')?.severity).toBe(
      'critical'
    )
    // critical threshold should not ALSO emit the warn duplicate
    expect(very.find((i) => i.id === 'duration-warn')).toBeUndefined()
  })

  test('flags SELECT without WHERE but leaves DDL alone', () => {
    const select = deriveQueryInsights({
      query: 'SELECT * FROM events',
      query_duration: 0.1,
      read_rows: 10,
      result_rows: 10,
      memory_usage: 0,
    })
    expect(select.find((i) => i.id === 'no-where')).toBeDefined()

    const ddl = deriveQueryInsights({
      query: 'CREATE TABLE t (x UInt8) ENGINE = MergeTree ORDER BY x',
      query_duration: 0.1,
      read_rows: 0,
      result_rows: 0,
      memory_usage: 0,
    })
    expect(ddl.find((i) => i.id === 'no-where')).toBeUndefined()
  })

  test('low-selectivity only fires on a material scan, not tiny reads', () => {
    const big = deriveQueryInsights({
      query: 'SELECT 1 WHERE 1',
      query_duration: 1,
      read_rows: 5_000_000,
      result_rows: 1,
      memory_usage: 0,
    })
    expect(big.find((i) => i.id === 'low-selectivity')).toBeDefined()

    const small = deriveQueryInsights({
      query: 'SELECT 1 WHERE 1',
      query_duration: 1,
      read_rows: 5000,
      result_rows: 1,
      memory_usage: 0,
    })
    expect(small.find((i) => i.id === 'low-selectivity')).toBeUndefined()
  })

  test('orders critical before warning before info', () => {
    const out = deriveQueryInsights({
      query: 'SELECT * FROM big_table',
      query_duration: 30,
      read_rows: 50_000_000,
      result_rows: 1,
      memory_usage: 5_000_000_000,
    })
    const severities = out.map((i) => i.severity)
    // critical entries must come before warning before info
    const ranks = { critical: 0, warning: 1, info: 2 }
    const nums = severities.map((s) => ranks[s])
    expect([...nums].sort((a, b) => a - b)).toEqual(nums)
  })
})
