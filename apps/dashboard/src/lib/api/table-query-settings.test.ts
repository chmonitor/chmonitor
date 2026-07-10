import type { QueryConfig } from '@/types/query-config'

import {
  capTableResultRows,
  detectTableTruncation,
  getTableClickHouseSettings,
  resolveTableResultRowLimit,
  TABLE_RESULT_OVERFLOW_MODE,
  TABLE_RESULT_ROW_LIMIT,
} from './table-query-settings'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  test('TABLE_RESULT_ROW_LIMIT is 10000', () => {
    expect(TABLE_RESULT_ROW_LIMIT).toBe(10_000)
  })

  test('TABLE_RESULT_OVERFLOW_MODE is "break"', () => {
    expect(TABLE_RESULT_OVERFLOW_MODE).toBe('break')
  })
})

// ---------------------------------------------------------------------------
// getTableClickHouseSettings
// ---------------------------------------------------------------------------

describe('getTableClickHouseSettings', () => {
  test('returns default row limit and overflow mode when config is undefined', () => {
    const result = getTableClickHouseSettings(undefined, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
    expect(result.result_overflow_mode).toBe(TABLE_RESULT_OVERFLOW_MODE)
  })

  test('does not include session_timezone when timezone is undefined', () => {
    const result = getTableClickHouseSettings(undefined, undefined)

    expect(result.session_timezone).toBeUndefined()
  })

  test('does not include session_timezone when timezone is empty string', () => {
    const result = getTableClickHouseSettings(undefined, '')

    expect(result.session_timezone).toBeUndefined()
  })

  test('sets session_timezone when timezone is provided', () => {
    const result = getTableClickHouseSettings(undefined, 'America/New_York')

    expect(result.session_timezone).toBe('America/New_York')
  })

  test('uses config clickhouseSettings max_result_rows when below row limit', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '500' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe('500')
  })

  test('caps max_result_rows at TABLE_RESULT_ROW_LIMIT when config exceeds limit', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '50000' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
  })

  test('keeps a config max_result_rows under the new 10k default (#2490)', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '5000' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe('5000')
  })

  test('uses TABLE_RESULT_ROW_LIMIT when config max_result_rows is 0', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '0' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
  })

  test('uses TABLE_RESULT_ROW_LIMIT when config max_result_rows is negative', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '-1' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
  })

  test('uses TABLE_RESULT_ROW_LIMIT when config max_result_rows is NaN string', () => {
    const config = {
      clickhouseSettings: { max_result_rows: 'not-a-number' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
  })

  test('uses TABLE_RESULT_ROW_LIMIT when config max_result_rows is undefined', () => {
    const config = {
      clickhouseSettings: {},
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
  })

  test('spreads other clickhouseSettings from config', () => {
    const config = {
      clickhouseSettings: {
        max_execution_time: 60,
        max_result_rows: '100',
      },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_execution_time).toBe(60)
  })

  test('result_overflow_mode is always "break" regardless of config', () => {
    const config = {
      clickhouseSettings: {
        result_overflow_mode: 'throw' as const,
      },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    // Our function always sets this to TABLE_RESULT_OVERFLOW_MODE ('break')
    expect(result.result_overflow_mode).toBe(TABLE_RESULT_OVERFLOW_MODE)
  })

  test('handles config with no clickhouseSettings property', () => {
    const config = {} as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, undefined)

    expect(result.max_result_rows).toBe(String(TABLE_RESULT_ROW_LIMIT))
    expect(result.result_overflow_mode).toBe(TABLE_RESULT_OVERFLOW_MODE)
  })

  test('combines timezone with config settings', () => {
    const config = {
      clickhouseSettings: { max_result_rows: '200' },
    } as unknown as QueryConfig

    const result = getTableClickHouseSettings(config, 'UTC')

    expect(result.session_timezone).toBe('UTC')
    expect(result.max_result_rows).toBe('200')
    expect(result.result_overflow_mode).toBe(TABLE_RESULT_OVERFLOW_MODE)
  })
})

// ---------------------------------------------------------------------------
// capTableResultRows
// ---------------------------------------------------------------------------

describe('capTableResultRows', () => {
  test('returns truncated: false and data unchanged when not an array', () => {
    const obj = { key: 'value' }
    const result = capTableResultRows(obj, 10)

    expect(result.data).toBe(obj)
    expect(result.truncated).toBe(false)
    expect(result.sourceRows).toBeUndefined()
    expect(result.returnedRows).toBeUndefined()
  })

  test('returns truncated: false for null (non-array)', () => {
    const result = capTableResultRows(null, 10)

    expect(result.data).toBeNull()
    expect(result.truncated).toBe(false)
  })

  test('returns truncated: false for string (non-array)', () => {
    const result = capTableResultRows('hello', 10)

    expect(result.data).toBe('hello')
    expect(result.truncated).toBe(false)
  })

  test('returns full data when array length equals row limit', () => {
    const data = [1, 2, 3]
    const result = capTableResultRows(data, 3)

    expect(result.data).toEqual([1, 2, 3])
    expect(result.sourceRows).toBe(3)
    expect(result.returnedRows).toBe(3)
    expect(result.truncated).toBe(false)
  })

  test('returns full data when array length is below row limit', () => {
    const data = ['a', 'b']
    const result = capTableResultRows(data, 5)

    expect(result.data).toEqual(['a', 'b'])
    expect(result.sourceRows).toBe(2)
    expect(result.returnedRows).toBe(2)
    expect(result.truncated).toBe(false)
  })

  test('truncates when array length exceeds row limit', () => {
    const data = [1, 2, 3, 4, 5]
    const result = capTableResultRows(data, 3)

    expect(result.data).toEqual([1, 2, 3])
    expect(result.sourceRows).toBe(5)
    expect(result.returnedRows).toBe(3)
    expect(result.truncated).toBe(true)
  })

  test('original array is not mutated when truncation occurs', () => {
    const data = [1, 2, 3, 4, 5]
    capTableResultRows(data, 3)

    expect(data).toHaveLength(5)
  })

  test('handles empty array', () => {
    const result = capTableResultRows([], 10)

    expect(result.data).toEqual([])
    expect(result.sourceRows).toBe(0)
    expect(result.returnedRows).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('handles row limit of 0 — all rows are truncated', () => {
    const data = [1, 2, 3]
    const result = capTableResultRows(data, 0)

    expect(result.data).toEqual([])
    expect(result.sourceRows).toBe(3)
    expect(result.returnedRows).toBe(0)
    expect(result.truncated).toBe(true)
  })

  test('works with array of objects', () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const result = capTableResultRows(data, 2)

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.sourceRows).toBe(3)
    expect(result.returnedRows).toBe(2)
    expect(result.truncated).toBe(true)
  })

  test('uses TABLE_RESULT_ROW_LIMIT as row limit in real-world usage', () => {
    const data = Array.from({ length: TABLE_RESULT_ROW_LIMIT + 1 }, (_, i) => i)
    const result = capTableResultRows(data, TABLE_RESULT_ROW_LIMIT)

    expect(result.truncated).toBe(true)
    expect(result.returnedRows).toBe(TABLE_RESULT_ROW_LIMIT)
    expect(result.sourceRows).toBe(TABLE_RESULT_ROW_LIMIT + 1)
    expect((result.data as number[]).length).toBe(TABLE_RESULT_ROW_LIMIT)
  })

  test('exactly at limit is not truncated', () => {
    const data = Array.from({ length: TABLE_RESULT_ROW_LIMIT }, (_, i) => i)
    const result = capTableResultRows(data, TABLE_RESULT_ROW_LIMIT)

    expect(result.truncated).toBe(false)
    expect(result.returnedRows).toBe(TABLE_RESULT_ROW_LIMIT)
  })
})

// ---------------------------------------------------------------------------
// resolveTableResultRowLimit
// ---------------------------------------------------------------------------

describe('resolveTableResultRowLimit', () => {
  test('returns the default when env is undefined', () => {
    expect(resolveTableResultRowLimit(undefined)).toBe(TABLE_RESULT_ROW_LIMIT)
  })

  test('returns the default when env is an empty string', () => {
    expect(resolveTableResultRowLimit('')).toBe(TABLE_RESULT_ROW_LIMIT)
  })

  test('parses a positive numeric override', () => {
    expect(resolveTableResultRowLimit('500')).toBe(500)
  })

  test('floors a fractional override', () => {
    expect(resolveTableResultRowLimit('500.9')).toBe(500)
  })

  test('returns 0 (disabled) when env is "0"', () => {
    expect(resolveTableResultRowLimit('0')).toBe(0)
  })

  test('returns 0 (disabled) when env is negative', () => {
    expect(resolveTableResultRowLimit('-5')).toBe(0)
  })

  test('returns 0 (disabled) when env is not a number', () => {
    expect(resolveTableResultRowLimit('not-a-number')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getTableClickHouseSettings — cap disabled
// ---------------------------------------------------------------------------

describe('getTableClickHouseSettings with cap disabled', () => {
  test('omits max_result_rows/result_overflow_mode when cap is 0', () => {
    const result = getTableClickHouseSettings(undefined, undefined, 0)

    expect(result.max_result_rows).toBeUndefined()
    expect(result.result_overflow_mode).toBeUndefined()
  })

  test('still spreads config settings and timezone when cap is 0', () => {
    const config = {
      clickhouseSettings: { max_execution_time: 60 },
    } as unknown as QueryConfig
    const result = getTableClickHouseSettings(config, 'UTC', 0)

    expect(result.max_execution_time).toBe(60)
    expect(result.session_timezone).toBe('UTC')
  })
})

// ---------------------------------------------------------------------------
// detectTableTruncation
// ---------------------------------------------------------------------------

describe('detectTableTruncation', () => {
  test('not truncated when cap is disabled (0)', () => {
    const result = detectTableTruncation({
      dataLength: 100,
      cap: 0,
      rowsBeforeLimit: 500,
    })
    expect(result.truncated).toBe(false)
    expect(result.rowsBeforeCap).toBeUndefined()
  })

  test('not truncated when rowsBeforeLimit is undefined', () => {
    const result = detectTableTruncation({
      dataLength: 100,
      cap: 100,
      rowsBeforeLimit: undefined,
    })
    expect(result.truncated).toBe(false)
  })

  test('not truncated when under cap', () => {
    const result = detectTableTruncation({
      dataLength: 50,
      cap: 100,
      rowsBeforeLimit: 50,
    })
    expect(result.truncated).toBe(false)
  })

  test('truncated when rowsBeforeLimit exceeds returned rows', () => {
    const result = detectTableTruncation({
      dataLength: 100,
      cap: 100,
      rowsBeforeLimit: 5000,
    })
    expect(result.truncated).toBe(true)
    expect(result.rowsBeforeCap).toBe(5000)
  })

  test('not truncated when rowsBeforeLimit equals dataLength exactly', () => {
    const result = detectTableTruncation({
      dataLength: 100,
      cap: 100,
      rowsBeforeLimit: 100,
    })
    expect(result.truncated).toBe(false)
  })
})
