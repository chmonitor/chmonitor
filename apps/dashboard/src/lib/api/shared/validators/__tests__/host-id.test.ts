/**
 * Tests for lib/api/shared/validators/host-id
 *
 * Covers every exported function with valid inputs, invalid branches, and
 * boundary values. Each test encodes WHY the rule matters (hostId indexes the
 * configured ClickHouse hosts, so it must be a non-negative integer) and is
 * written to fail if the validation logic changes.
 */
import { describe, expect, test } from 'bun:test'
import {
  getAndValidateHostId,
  validateHostId,
  validateHostIdWithError,
} from '@/lib/api/shared/validators/host-id'
import { ApiErrorType } from '@/lib/api/types'

// ---------------------------------------------------------------------------
// validateHostId — throwing variant
// ---------------------------------------------------------------------------

describe('validateHostId', () => {
  test('parses a valid numeric string to a number', () => {
    expect(validateHostId('0')).toBe(0)
    expect(validateHostId('1')).toBe(1)
    expect(validateHostId('42')).toBe(42)
  })

  test('accepts host index 0 (first configured host, not falsy-rejected)', () => {
    // Guards against a `!parsed` regression — 0 is a valid host index.
    expect(validateHostId('0')).toBe(0)
  })

  test('rejects trailing non-digit characters (unlike parseInt)', () => {
    // parseInt('1abc', 10) === 1; the strict parser must not silently
    // truncate at the first non-digit — that risks routing a mistyped/junk
    // hostId to a real, but wrong, host.
    expect(() => validateHostId('1abc')).toThrow(
      'Invalid hostId: must be a non-negative number'
    )
    expect(() => validateHostId('2abc')).toThrow(
      'Invalid hostId: must be a non-negative number'
    )
  })

  test('throws when hostId is null', () => {
    expect(() => validateHostId(null)).toThrow(
      'Missing required parameter: hostId'
    )
  })

  test('throws when hostId is an empty string', () => {
    expect(() => validateHostId('')).toThrow(
      'Missing required parameter: hostId'
    )
  })

  test('throws when hostId is non-numeric', () => {
    expect(() => validateHostId('abc')).toThrow(
      'Invalid hostId: must be a non-negative number'
    )
  })

  test('throws when hostId is negative', () => {
    expect(() => validateHostId('-1')).toThrow(
      'Invalid hostId: must be a non-negative number'
    )
  })
})

// ---------------------------------------------------------------------------
// validateHostIdWithError — non-throwing, accepts unknown
// ---------------------------------------------------------------------------

describe('validateHostIdWithError', () => {
  test('returns undefined for a valid number', () => {
    expect(validateHostIdWithError(0)).toBeUndefined()
    expect(validateHostIdWithError(3)).toBeUndefined()
  })

  test('returns undefined for a valid numeric string', () => {
    expect(validateHostIdWithError('0')).toBeUndefined()
    expect(validateHostIdWithError('7')).toBeUndefined()
  })

  test('returns a ValidationError for undefined', () => {
    const err = validateHostIdWithError(undefined)
    expect(err).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Missing required field: hostId',
    })
  })

  test('returns a ValidationError for null', () => {
    expect(validateHostIdWithError(null)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Missing required field: hostId',
    })
  })

  test('returns a ValidationError for an empty string', () => {
    expect(validateHostIdWithError('')).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Missing required field: hostId',
    })
  })

  test('returns a ValidationError for a negative number', () => {
    expect(validateHostIdWithError(-1)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })

  test('returns a ValidationError for a non-numeric string', () => {
    expect(validateHostIdWithError('abc')).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })

  test('returns a ValidationError for a non-string, non-number type (boolean)', () => {
    // The `typeof` ladder falls through to NaN for unsupported types.
    expect(validateHostIdWithError(true)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })

  test('returns a ValidationError for an object', () => {
    expect(validateHostIdWithError({ hostId: 1 })).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })

  test('does NOT reject host index 0 as missing (0 is falsy but valid)', () => {
    // Distinguishes the "missing" branch (undefined/null/'') from numeric 0.
    expect(validateHostIdWithError(0)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getAndValidateHostId — reads from URLSearchParams
// ---------------------------------------------------------------------------

describe('getAndValidateHostId', () => {
  test('returns the parsed number for a valid hostId param', () => {
    const params = new URLSearchParams('hostId=2')
    expect(getAndValidateHostId(params)).toBe(2)
  })

  test('returns 0 for hostId=0 (first host, not treated as missing)', () => {
    const params = new URLSearchParams('hostId=0')
    expect(getAndValidateHostId(params)).toBe(0)
  })

  test('returns a ValidationError when hostId param is absent', () => {
    const params = new URLSearchParams('other=1')
    expect(getAndValidateHostId(params)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Missing required parameter: hostId',
    })
  })

  test('returns a ValidationError when hostId is empty', () => {
    const params = new URLSearchParams('hostId=')
    expect(getAndValidateHostId(params)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Missing required parameter: hostId',
    })
  })

  test('returns a ValidationError when hostId is non-numeric', () => {
    const params = new URLSearchParams('hostId=abc')
    expect(getAndValidateHostId(params)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })

  test('returns a ValidationError when hostId is negative', () => {
    const params = new URLSearchParams('hostId=-5')
    expect(getAndValidateHostId(params)).toEqual({
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    })
  })
})
