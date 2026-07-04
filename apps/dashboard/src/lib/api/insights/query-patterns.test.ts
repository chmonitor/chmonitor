import { describe, expect, test } from 'bun:test'
import {
  buildPatternDetailConfig,
  buildPatternExecutionsConfig,
  isValidQueryHash,
  parseRangeHours,
  sortPatternRows,
} from '@/lib/api/insights/query-patterns'

describe('isValidQueryHash', () => {
  test('accepts numeric strings', () => {
    expect(isValidQueryHash('123')).toBe(true)
    expect(isValidQueryHash('12345678901234567890')).toBe(true)
  })

  test('rejects non-numeric input', () => {
    expect(isValidQueryHash('')).toBe(false)
    expect(isValidQueryHash('abc')).toBe(false)
    expect(isValidQueryHash('-1')).toBe(false)
    expect(isValidQueryHash('1.5')).toBe(false)
    expect(isValidQueryHash('1; DROP TABLE x')).toBe(false)
  })
})

describe('parseRangeHours', () => {
  test('defaults to 24 when absent or invalid', () => {
    expect(parseRangeHours(null)).toBe(24)
    expect(parseRangeHours('')).toBe(24)
    expect(parseRangeHours('abc')).toBe(24)
    expect(parseRangeHours('-5')).toBe(24)
    expect(parseRangeHours('0')).toBe(24)
  })

  test('parses a valid value', () => {
    expect(parseRangeHours('6')).toBe(6)
  })

  test('clamps to the max window', () => {
    expect(parseRangeHours('999999', 24, 720)).toBe(720)
  })
})

describe('sortPatternRows', () => {
  const rows = [
    { calls: 5, name: 'b' },
    { calls: 1, name: 'a' },
    { calls: 3, name: 'c' },
  ]

  test('no-op without a sort param', () => {
    expect(sortPatternRows(rows, undefined)).toBe(rows)
  })

  test('no-op for an unknown column', () => {
    expect(sortPatternRows(rows, 'missing_column')).toBe(rows)
  })

  test('sorts descending by default', () => {
    expect(sortPatternRows(rows, 'calls').map((r) => r.calls)).toEqual([
      5, 3, 1,
    ])
  })

  test('sorts ascending when requested', () => {
    expect(sortPatternRows(rows, 'calls:asc').map((r) => r.calls)).toEqual([
      1, 3, 5,
    ])
  })

  test('falls back to string comparison for non-numeric columns', () => {
    expect(sortPatternRows(rows, 'name:asc').map((r) => r.name)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('buildPatternDetailConfig / buildPatternExecutionsConfig', () => {
  test('the detail config filters by hash and time window', () => {
    const config = buildPatternDetailConfig()
    expect(config.tableCheck).toBe('system.query_log')
    const sqlText = JSON.stringify(config.sql)
    expect(sqlText).toContain('normalized_query_hash')
    expect(sqlText).toContain('range_hours')
  })

  test('the executions config is reverse-chronological and limited', () => {
    const config = buildPatternExecutionsConfig()
    expect(config.sql as string).toContain('ORDER BY event_time DESC')
    expect(config.sql as string).toContain('executions_limit')
  })
})
