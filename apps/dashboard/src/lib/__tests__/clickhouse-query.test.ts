import { describe, expect, test } from 'bun:test'
import {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
  fillStep,
  nowOrToday,
  withQueryParams,
} from '@/lib/clickhouse-query'

describe('applyInterval', () => {
  test('wraps date-returning intervals with toDate()', () => {
    expect(applyInterval('toStartOfMonth', 'event_time')).toBe(
      'toDate(toStartOfMonth(event_time)) AS event_time'
    )
    expect(applyInterval('toStartOfWeek', 'event_time')).toBe(
      'toDate(toStartOfWeek(event_time)) AS event_time'
    )
    expect(applyInterval('toStartOfDay', 'ts')).toBe(
      'toDate(toStartOfDay(ts)) AS ts'
    )
  })

  test('passes through non-date intervals as-is', () => {
    expect(applyInterval('toStartOfHour', 'event_time')).toBe(
      'toStartOfHour(event_time) AS event_time'
    )
    expect(applyInterval('toStartOfMinute', 'event_time')).toBe(
      'toStartOfMinute(event_time) AS event_time'
    )
  })

  test('uses alias when provided', () => {
    expect(applyInterval('toStartOfHour', 'event_time', 'hour')).toBe(
      'toStartOfHour(event_time) AS hour'
    )
    expect(applyInterval('toStartOfMonth', 'event_time', 'month')).toBe(
      'toDate(toStartOfMonth(event_time)) AS month'
    )
  })
})

describe('fillStep', () => {
  test('returns correct interval for each granularity', () => {
    expect(fillStep('toStartOfMinute')).toBe('toIntervalMinute(1)')
    expect(fillStep('toStartOfFiveMinutes')).toBe('toIntervalMinute(5)')
    expect(fillStep('toStartOfTenMinutes')).toBe('toIntervalMinute(10)')
    expect(fillStep('toStartOfFifteenMinutes')).toBe('toIntervalMinute(15)')
    expect(fillStep('toStartOfHour')).toBe('toIntervalHour(1)')
    expect(fillStep('toStartOfDay')).toBe('toIntervalDay(1)')
    expect(fillStep('toStartOfWeek')).toBe('toIntervalDay(7)')
    expect(fillStep('toStartOfMonth')).toBe('toIntervalMonth(1)')
  })

  test('falls back to a safe default instead of empty string for an unknown interval', () => {
    // Guards against WITH FILL STEP  (empty) malformed SQL.
    expect(fillStep('unknown' as any)).toBe('toIntervalMinute(1)')
  })
})

describe('nowOrToday', () => {
  test('returns now() for sub-day intervals', () => {
    expect(nowOrToday('toStartOfMinute')).toBe('now()')
    expect(nowOrToday('toStartOfHour')).toBe('now()')
  })

  test('returns today() for day+ intervals', () => {
    expect(nowOrToday('toStartOfDay')).toBe('today()')
    expect(nowOrToday('toStartOfWeek')).toBe('today()')
    expect(nowOrToday('toStartOfMonth')).toBe('today()')
  })

  test('falls back to a safe default instead of empty string for an unknown interval', () => {
    // Guards against WITH FILL TO  (empty) malformed SQL.
    expect(nowOrToday('unknown' as any)).toBe('now()')
  })
})

describe('buildTimeFilter', () => {
  test('returns empty string for undefined lastHours', () => {
    expect(buildTimeFilter(undefined)).toBe('')
  })

  test('returns SQL condition for valid lastHours', () => {
    expect(buildTimeFilter(24)).toBe('event_time >= (now() - INTERVAL 24 HOUR)')
  })

  test('uses custom column name', () => {
    expect(buildTimeFilter(12, 'query_start_time')).toBe(
      'query_start_time >= (now() - INTERVAL 12 HOUR)'
    )
  })

  test('floors fractional hours', () => {
    expect(buildTimeFilter(24.7)).toBe(
      'event_time >= (now() - INTERVAL 24 HOUR)'
    )
  })

  test('rejects zero and negative values', () => {
    expect(buildTimeFilter(0)).toBe('')
    expect(buildTimeFilter(-1)).toBe('')
  })

  test('rejects NaN and Infinity', () => {
    expect(buildTimeFilter(NaN)).toBe('')
    expect(buildTimeFilter(Infinity)).toBe('')
  })
})

describe('buildTimeFilterInterval', () => {
  test('returns empty string for undefined lastHours', () => {
    expect(buildTimeFilterInterval(undefined)).toBe('')
  })

  test('returns toIntervalHour form', () => {
    expect(buildTimeFilterInterval(24)).toBe(
      'event_time >= (now() - toIntervalHour(24))'
    )
  })

  test('uses custom column', () => {
    expect(buildTimeFilterInterval(6, 'query_start_time')).toBe(
      'query_start_time >= (now() - toIntervalHour(6))'
    )
  })

  test('rejects invalid values', () => {
    expect(buildTimeFilterInterval(0)).toBe('')
    expect(buildTimeFilterInterval(-5)).toBe('')
    expect(buildTimeFilterInterval(NaN)).toBe('')
  })
})

describe('withQueryParams', () => {
  test('returns query as-is when no params', () => {
    const q = 'SELECT 1'
    expect(withQueryParams(q)).toBe(q)
    expect(withQueryParams(q, {})).toBe(q)
  })

  test('prepends SET statements for numeric params', () => {
    const result = withQueryParams('SELECT {limit:UInt64} FROM t', {
      limit: 100,
    })
    expect(result).toContain('SET param_limit=100')
    expect(result).toContain('SELECT {limit:UInt64} FROM t')
  })

  test('handles string params with quote escaping', () => {
    const result = withQueryParams('SELECT {name:String}', {
      name: "O'Brien",
    })
    expect(result).toContain("SET param_name='O\\'Brien'")
  })

  test('escapes a single backslash in string values', () => {
    const result = withQueryParams('SELECT {s:String}', { s: 'a\\b' })
    expect(result).toContain("SET param_s='a\\\\b'")
  })

  test('escapes a backslash immediately followed by a quote (injection case)', () => {
    // Naive quote-doubling would let this trailing backslash "consume" the
    // escaped quote, breaking out of the string literal. Backslash-first
    // escaping must render "\\\'" so the literal stays closed correctly.
    const result = withQueryParams('SELECT {s:String}', { s: "evil\\'; --" })
    expect(result).toBe("SET param_s='evil\\\\\\'; --';\nSELECT {s:String}")
  })

  test('escapes backslashes so a trailing one cannot break out of the literal', () => {
    // A trailing backslash must not escape the closing quote of the SET literal.
    const result = withQueryParams('SELECT {path:String}', {
      path: 'C:\\',
    })
    expect(result).toContain("SET param_path='C:\\\\'")
  })

  test('handles boolean params', () => {
    const result = withQueryParams('SELECT {flag:UInt8}', { flag: true })
    expect(result).toContain('SET param_flag=1')

    const result2 = withQueryParams('SELECT {flag:UInt8}', { flag: false })
    expect(result2).toContain('SET param_flag=0')
  })

  test('handles multiple params', () => {
    const result = withQueryParams('SELECT 1', { a: 1, b: 'test' })
    expect(result).toContain('SET param_a=1')
    expect(result).toContain("SET param_b='test'")
  })
})
