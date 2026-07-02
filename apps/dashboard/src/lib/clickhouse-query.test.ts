import {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
  fillStep,
  nowOrToday,
  withQueryParams,
} from './clickhouse-query'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// applyInterval
// ---------------------------------------------------------------------------
describe('applyInterval', () => {
  test('toStartOfMonth wraps in toDate() and uses column as alias when none given', () => {
    expect(applyInterval('toStartOfMonth', 'event_time')).toBe(
      'toDate(toStartOfMonth(event_time)) AS event_time'
    )
  })

  test('toStartOfWeek wraps in toDate() and uses column as alias when none given', () => {
    expect(applyInterval('toStartOfWeek', 'event_time')).toBe(
      'toDate(toStartOfWeek(event_time)) AS event_time'
    )
  })

  test('toStartOfDay wraps in toDate() and uses column as alias when none given', () => {
    expect(applyInterval('toStartOfDay', 'event_time')).toBe(
      'toDate(toStartOfDay(event_time)) AS event_time'
    )
  })

  test('toStartOfMonth uses explicit alias', () => {
    expect(applyInterval('toStartOfMonth', 'event_time', 'ts')).toBe(
      'toDate(toStartOfMonth(event_time)) AS ts'
    )
  })

  test('toStartOfHour does NOT wrap in toDate(), uses column as alias', () => {
    expect(applyInterval('toStartOfHour', 'event_time')).toBe(
      'toStartOfHour(event_time) AS event_time'
    )
  })

  test('toStartOfMinute does NOT wrap in toDate()', () => {
    expect(applyInterval('toStartOfMinute', 'event_time')).toBe(
      'toStartOfMinute(event_time) AS event_time'
    )
  })

  test('toStartOfFiveMinutes with explicit alias', () => {
    expect(applyInterval('toStartOfFiveMinutes', 'ts', 'bucket')).toBe(
      'toStartOfFiveMinutes(ts) AS bucket'
    )
  })

  test('toStartOfTenMinutes with explicit alias', () => {
    expect(applyInterval('toStartOfTenMinutes', 'ts', 'bucket')).toBe(
      'toStartOfTenMinutes(ts) AS bucket'
    )
  })

  test('toStartOfFifteenMinutes uses column as alias', () => {
    expect(applyInterval('toStartOfFifteenMinutes', 'ts')).toBe(
      'toStartOfFifteenMinutes(ts) AS ts'
    )
  })
})

// ---------------------------------------------------------------------------
// fillStep
// ---------------------------------------------------------------------------
describe('fillStep', () => {
  const cases: Array<[Parameters<typeof fillStep>[0], string]> = [
    ['toStartOfMinute', 'toIntervalMinute(1)'],
    ['toStartOfFiveMinutes', 'toIntervalMinute(5)'],
    ['toStartOfTenMinutes', 'toIntervalMinute(10)'],
    ['toStartOfFifteenMinutes', 'toIntervalMinute(15)'],
    ['toStartOfHour', 'toIntervalHour(1)'],
    ['toStartOfDay', 'toIntervalDay(1)'],
    ['toStartOfWeek', 'toIntervalDay(7)'],
    ['toStartOfMonth', 'toIntervalMonth(1)'],
  ]

  test.each(cases)('fillStep(%s) === %s', (interval, expected) => {
    expect(fillStep(interval)).toBe(expected)
  })

  test('falls back to a safe default instead of empty string for an unmapped interval', () => {
    // Guards against WITH FILL STEP  (empty) malformed SQL if a new
    // ClickHouseInterval variant is added without an intervalMap entry.
    expect(fillStep('unknown' as never)).toBe('toIntervalMinute(1)')
  })
})

// ---------------------------------------------------------------------------
// nowOrToday
// ---------------------------------------------------------------------------
describe('nowOrToday', () => {
  const cases: Array<[Parameters<typeof nowOrToday>[0], string]> = [
    ['toStartOfMinute', 'now()'],
    ['toStartOfFiveMinutes', 'now()'],
    ['toStartOfTenMinutes', 'now()'],
    ['toStartOfFifteenMinutes', 'now()'],
    ['toStartOfHour', 'now()'],
    ['toStartOfDay', 'today()'],
    ['toStartOfWeek', 'today()'],
    ['toStartOfMonth', 'today()'],
  ]

  test.each(cases)('nowOrToday(%s) === %s', (interval, expected) => {
    expect(nowOrToday(interval)).toBe(expected)
  })

  test('falls back to a safe default instead of empty string for an unmapped interval', () => {
    // Guards against WITH FILL TO  (empty) malformed SQL if a new
    // ClickHouseInterval variant is added without an intervalMap entry.
    expect(nowOrToday('unknown' as never)).toBe('now()')
  })
})

// ---------------------------------------------------------------------------
// buildTimeFilter
// ---------------------------------------------------------------------------
describe('buildTimeFilter', () => {
  test('returns SQL with default column when given a positive integer', () => {
    expect(buildTimeFilter(24)).toBe('event_time >= (now() - INTERVAL 24 HOUR)')
  })

  test('uses provided column name', () => {
    expect(buildTimeFilter(12, 'query_start_time')).toBe(
      'query_start_time >= (now() - INTERVAL 12 HOUR)'
    )
  })

  test('returns empty string when lastHours is undefined', () => {
    expect(buildTimeFilter(undefined)).toBe('')
  })

  test('floors fractional hours', () => {
    expect(buildTimeFilter(1.9)).toBe('event_time >= (now() - INTERVAL 1 HOUR)')
  })

  test('returns empty string for 0', () => {
    expect(buildTimeFilter(0)).toBe('')
  })

  test('returns empty string for negative values', () => {
    expect(buildTimeFilter(-5)).toBe('')
  })

  test('returns empty string for NaN (Math.floor(NaN) is NaN, not finite)', () => {
    expect(buildTimeFilter(Number.NaN)).toBe('')
  })

  test('returns empty string for Infinity', () => {
    expect(buildTimeFilter(Infinity)).toBe('')
  })

  test('handles large hour values', () => {
    expect(buildTimeFilter(8760)).toBe(
      'event_time >= (now() - INTERVAL 8760 HOUR)'
    )
  })
})

// ---------------------------------------------------------------------------
// buildTimeFilterInterval
// ---------------------------------------------------------------------------
describe('buildTimeFilterInterval', () => {
  test('returns SQL with toIntervalHour and default column', () => {
    expect(buildTimeFilterInterval(24)).toBe(
      'event_time >= (now() - toIntervalHour(24))'
    )
  })

  test('uses provided column name', () => {
    expect(buildTimeFilterInterval(6, 'query_start_time')).toBe(
      'query_start_time >= (now() - toIntervalHour(6))'
    )
  })

  test('returns empty string when lastHours is undefined', () => {
    expect(buildTimeFilterInterval(undefined)).toBe('')
  })

  test('floors fractional hours', () => {
    expect(buildTimeFilterInterval(2.7)).toBe(
      'event_time >= (now() - toIntervalHour(2))'
    )
  })

  test('returns empty string for 0', () => {
    expect(buildTimeFilterInterval(0)).toBe('')
  })

  test('returns empty string for negative values', () => {
    expect(buildTimeFilterInterval(-1)).toBe('')
  })

  test('returns empty string for NaN', () => {
    expect(buildTimeFilterInterval(Number.NaN)).toBe('')
  })

  test('returns empty string for Infinity', () => {
    expect(buildTimeFilterInterval(Infinity)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// withQueryParams
// ---------------------------------------------------------------------------
describe('withQueryParams', () => {
  test('returns query unchanged when no params', () => {
    const q = 'SELECT 1'
    expect(withQueryParams(q)).toBe(q)
  })

  test('returns query unchanged for empty params object', () => {
    const q = 'SELECT 1'
    expect(withQueryParams(q, {})).toBe(q)
  })

  test('prepends SET for a string param with single-quoted value', () => {
    const result = withQueryParams('SELECT {db:String}', { db: 'mydb' })
    expect(result).toBe("SET param_db='mydb';\nSELECT {db:String}")
  })

  test('escapes single quotes in string values', () => {
    const result = withQueryParams('SELECT {s:String}', { s: "O'Brien" })
    expect(result).toBe("SET param_s='O\\'Brien';\nSELECT {s:String}")
  })

  test('escapes multiple single quotes in string values', () => {
    const result = withQueryParams('SELECT {s:String}', { s: "it's a 'test'" })
    expect(result).toBe("SET param_s='it\\'s a \\'test\\'';\nSELECT {s:String}")
  })

  test('serialises boolean true as 1', () => {
    const result = withQueryParams('SELECT {flag:UInt8}', { flag: true })
    expect(result).toBe('SET param_flag=1;\nSELECT {flag:UInt8}')
  })

  test('serialises boolean false as 0', () => {
    const result = withQueryParams('SELECT {flag:UInt8}', { flag: false })
    expect(result).toBe('SET param_flag=0;\nSELECT {flag:UInt8}')
  })

  test('serialises number param without quotes', () => {
    const result = withQueryParams('SELECT {n:UInt64}', { n: 42 })
    expect(result).toBe('SET param_n=42;\nSELECT {n:UInt64}')
  })

  test('multiple params are joined with semicolon-newline', () => {
    const result = withQueryParams('SELECT {a:String}, {b:UInt8}', {
      a: 'hello',
      b: 7,
    })
    // Two SET lines, then query
    const lines = result.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("SET param_a='hello';")
    expect(lines[1]).toBe('SET param_b=7;')
    expect(lines[2]).toBe('SELECT {a:String}, {b:UInt8}')
  })

  test('dedents indented query', () => {
    const query = `
      SELECT *
      FROM system.query_log
    `
    const result = withQueryParams(query, { x: 1 })
    // After SET line, query should be dedented
    const parts = result.split(';\n')
    const queryPart = parts[parts.length - 1]
    // dedent strips leading common whitespace
    expect(queryPart).not.toMatch(/^ {6}/)
  })

  test('null param is serialised without quotes', () => {
    const result = withQueryParams('SELECT {n:Nullable(String)}', { n: null })
    expect(result).toBe('SET param_n=null;\nSELECT {n:Nullable(String)}')
  })
})
