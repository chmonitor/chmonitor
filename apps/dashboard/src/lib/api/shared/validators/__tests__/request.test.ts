/**
 * Tests for lib/api/shared/validators/request
 *
 * Covers every exported function with valid inputs, invalid branches,
 * and boundary values. Each test is written to fail if the logic changes.
 */
import { describe, expect, test } from 'bun:test'
import {
  validateDataRequest,
  validateEnumValue,
  validateIntervalParam,
  validatePaginationParams,
  validateRequiredString,
  validateSearchParams,
} from '@/lib/api/shared/validators/request'
import { ApiErrorType } from '@/lib/api/types'

// ---------------------------------------------------------------------------
// validateRequiredString
// ---------------------------------------------------------------------------

describe('validateRequiredString', () => {
  test('returns undefined for a valid non-empty string', () => {
    expect(validateRequiredString('SELECT 1', 'query')).toBeUndefined()
  })

  test('returns undefined for a string with only internal spaces (not trimmed to empty)', () => {
    expect(validateRequiredString('a b', 'query')).toBeUndefined()
  })

  test('returns ValidationError when value is empty string', () => {
    const err = validateRequiredString('', 'query')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('query')
  })

  test('returns ValidationError when value is whitespace-only', () => {
    const err = validateRequiredString('   ', 'query')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('returns ValidationError when value is undefined', () => {
    const err = validateRequiredString(undefined, 'myField')
    expect(err).toBeDefined()
    expect(err?.message).toContain('myField')
  })

  test('returns ValidationError when value is null', () => {
    const err = validateRequiredString(null, 'myField')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('returns ValidationError when value is a number', () => {
    const err = validateRequiredString(42, 'myField')
    expect(err).toBeDefined()
  })

  test('error message includes fieldName', () => {
    const err = validateRequiredString('', 'theFieldName')
    expect(err?.message).toContain('theFieldName')
  })
})

// ---------------------------------------------------------------------------
// validateDataRequest
// ---------------------------------------------------------------------------

describe('validateDataRequest', () => {
  test('returns undefined for a fully valid body', () => {
    const err = validateDataRequest({ query: 'SELECT 1', hostId: '0' })
    expect(err).toBeUndefined()
  })

  test('returns undefined for valid body with explicit format', () => {
    const err = validateDataRequest({
      query: 'SELECT 1',
      hostId: '1',
      format: 'JSON',
    })
    expect(err).toBeUndefined()
  })

  test('returns ValidationError when query is missing', () => {
    const err = validateDataRequest({ hostId: '0' })
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('query')
  })

  test('returns ValidationError when query is empty string', () => {
    const err = validateDataRequest({ query: '', hostId: '0' })
    expect(err).toBeDefined()
    expect(err?.message).toContain('query')
  })

  test('returns ValidationError when hostId is missing', () => {
    const err = validateDataRequest({ query: 'SELECT 1' })
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('hostId')
  })

  test('returns ValidationError when hostId is negative', () => {
    const err = validateDataRequest({ query: 'SELECT 1', hostId: '-1' })
    expect(err).toBeDefined()
    expect(err?.message).toContain('hostId')
  })

  test('returns ValidationError when format is unsupported', () => {
    const err = validateDataRequest({
      query: 'SELECT 1',
      hostId: '0',
      format: 'XML' as never,
    })
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('query error takes precedence over hostId error', () => {
    const err = validateDataRequest({ query: '', hostId: '-1' })
    expect(err?.message).toContain('query')
  })
})

// ---------------------------------------------------------------------------
// validateSearchParams
// ---------------------------------------------------------------------------

describe('validateSearchParams', () => {
  test('returns undefined when all required params are present', () => {
    const params = new URLSearchParams({ hostId: '0', sql: 'SELECT 1' })
    expect(validateSearchParams(params, ['hostId', 'sql'])).toBeUndefined()
  })

  test('returns undefined for empty requiredParams array', () => {
    const params = new URLSearchParams()
    expect(validateSearchParams(params, [])).toBeUndefined()
  })

  test('returns ValidationError when a param is missing', () => {
    const params = new URLSearchParams({ hostId: '0' })
    const err = validateSearchParams(params, ['hostId', 'sql'])
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('sql')
  })

  test('returns ValidationError when a param is present but empty', () => {
    const params = new URLSearchParams({ hostId: '0', sql: '' })
    const err = validateSearchParams(params, ['hostId', 'sql'])
    expect(err).toBeDefined()
    expect(err?.message).toContain('sql')
  })

  test('returns ValidationError when a param is whitespace-only', () => {
    const params = new URLSearchParams({ hostId: '   ' })
    const err = validateSearchParams(params, ['hostId'])
    expect(err).toBeDefined()
    expect(err?.message).toContain('hostId')
  })

  test('reports the first missing param', () => {
    const params = new URLSearchParams()
    const err = validateSearchParams(params, ['alpha', 'beta'])
    expect(err?.message).toContain('alpha')
  })
})

// ---------------------------------------------------------------------------
// validatePaginationParams
// ---------------------------------------------------------------------------

describe('validatePaginationParams', () => {
  test('returns default limit=100 offset=0 when params absent', () => {
    const params = new URLSearchParams()
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(100)
    expect(result.offset).toBe(0)
    expect(result.error).toBeUndefined()
  })

  test('parses valid limit and offset', () => {
    const params = new URLSearchParams({ limit: '50', offset: '10' })
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(10)
    expect(result.error).toBeUndefined()
  })

  test('accepts limit=1 (minimum positive integer)', () => {
    const params = new URLSearchParams({ limit: '1' })
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(1)
    expect(result.error).toBeUndefined()
  })

  test('accepts offset=0 (minimum non-negative integer)', () => {
    const params = new URLSearchParams({ offset: '0' })
    const result = validatePaginationParams(params)
    expect(result.offset).toBe(0)
    expect(result.error).toBeUndefined()
  })

  test('returns error when limit=0', () => {
    const params = new URLSearchParams({ limit: '0' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.type).toBe(ApiErrorType.ValidationError)
    expect(result.error?.message).toContain('limit')
  })

  test('returns error when limit is negative', () => {
    const params = new URLSearchParams({ limit: '-5' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('limit')
  })

  test('returns error when limit is non-numeric', () => {
    const params = new URLSearchParams({ limit: 'abc' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('limit')
  })

  test('returns error when limit exceeds 10000', () => {
    const params = new URLSearchParams({ limit: '10001' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('10000')
  })

  test('accepts limit=10000 (boundary — exactly at max)', () => {
    const params = new URLSearchParams({ limit: '10000' })
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(10000)
    expect(result.error).toBeUndefined()
  })

  test('returns error when offset is negative', () => {
    const params = new URLSearchParams({ offset: '-1' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('offset')
  })

  test('returns error when offset is non-numeric', () => {
    const params = new URLSearchParams({ offset: 'xyz' })
    const result = validatePaginationParams(params)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('offset')
  })

  test('limit error uses default values in returned object', () => {
    const params = new URLSearchParams({ limit: 'bad' })
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(100)
    expect(result.offset).toBe(0)
  })

  test('valid limit is preserved in returned object when offset errors', () => {
    const params = new URLSearchParams({ limit: '25', offset: 'bad' })
    const result = validatePaginationParams(params)
    expect(result.limit).toBe(25)
    expect(result.offset).toBe(0)
    expect(result.error).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// validateIntervalParam
// ---------------------------------------------------------------------------

describe('validateIntervalParam', () => {
  test('returns undefined for null (interval is optional)', () => {
    expect(validateIntervalParam(null)).toBeUndefined()
  })

  test('returns undefined for empty string (falsy → optional)', () => {
    expect(validateIntervalParam('')).toBeUndefined()
  })

  test('accepts every valid interval', () => {
    const valid = [
      'toStartOfMinute',
      'toStartOfFiveMinutes',
      'toStartOfTenMinutes',
      'toStartOfFifteenMinutes',
      'toStartOfHour',
      'toStartOfDay',
      'toStartOfWeek',
      'toStartOfMonth',
    ]
    for (const interval of valid) {
      expect(validateIntervalParam(interval)).toBeUndefined()
    }
  })

  test('returns ValidationError for an interval not backed by intervalMap', () => {
    // toStartOfQuarter/toStartOfYear/toStartOfSecond are ClickHouse functions
    // but are not in the app's supported interval set (see intervalMap in
    // clickhouse-query.ts) — must stay rejected so WITH FILL never gets an
    // empty fillStep/nowOrToday.
    const err = validateIntervalParam('toStartOfQuarter')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('toStartOfQuarter')
  })

  test('returns ValidationError for unknown interval', () => {
    const err = validateIntervalParam('toStartOfDecade')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('toStartOfDecade')
  })

  test('returns ValidationError for SQL-injection-style value', () => {
    const err = validateIntervalParam(
      "toStartOfDay'; DROP TABLE system.query_log;--"
    )
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('returns ValidationError for mixed-case variant of a valid interval', () => {
    const err = validateIntervalParam('TOSTARTOFDAY')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('error message lists at least one valid interval', () => {
    const err = validateIntervalParam('bad')
    expect(err?.message).toContain('toStartOfMinute')
  })
})

// ---------------------------------------------------------------------------
// validateEnumValue
// ---------------------------------------------------------------------------

describe('validateEnumValue', () => {
  const ALLOWED = ['asc', 'desc'] as const

  test('returns undefined for undefined (optional field)', () => {
    expect(validateEnumValue(undefined, ALLOWED, 'order')).toBeUndefined()
  })

  test('returns undefined for null (optional field)', () => {
    expect(validateEnumValue(null, ALLOWED, 'order')).toBeUndefined()
  })

  test('returns undefined for a valid allowed value', () => {
    expect(validateEnumValue('asc', ALLOWED, 'order')).toBeUndefined()
    expect(validateEnumValue('desc', ALLOWED, 'order')).toBeUndefined()
  })

  test('returns ValidationError when value is not in allowed list', () => {
    const err = validateEnumValue('random', ALLOWED, 'order')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
    expect(err?.message).toContain('order')
  })

  test('error message lists allowed values', () => {
    const err = validateEnumValue('bad', ALLOWED, 'order')
    expect(err?.message).toContain('asc')
    expect(err?.message).toContain('desc')
  })

  test('returns ValidationError when value is a number (wrong type)', () => {
    const err = validateEnumValue(1, ALLOWED, 'order')
    expect(err).toBeDefined()
    expect(err?.message).toContain('string')
  })

  test('returns ValidationError when value is an object', () => {
    const err = validateEnumValue({}, ALLOWED, 'order')
    expect(err).toBeDefined()
    expect(err?.type).toBe(ApiErrorType.ValidationError)
  })

  test('is case-sensitive — "ASC" is not valid when only "asc" is allowed', () => {
    const err = validateEnumValue('ASC', ALLOWED, 'order')
    expect(err).toBeDefined()
  })
})
