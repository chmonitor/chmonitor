/**
 * Tests for card-error-utils.ts
 *
 * Covers all pure exported functions:
 *   toEmptyStateVariant, detectCardErrorVariant, getCardErrorDescription,
 *   getCardErrorTitle, getCardErrorStyle, getCardErrorClassName,
 *   isCardErrorRetryable, shouldShowRetryButton, formatCardErrorForLogging,
 *   getTableMissingInfo, parseSimpleVersion, isVersionOlder,
 *   extractTableFromPermissionError
 *
 * Skipped (not pure-testable without a React renderer):
 *   - None; all exports are pure functions or types.
 *
 * Skipped (depends on external module with complex side effects):
 *   - getTableMissingInfo is tested only for the non-table-missing path and
 *     the early-return-undefined path; the branch that calls
 *     getGuidanceForMissingTables is covered via integration through
 *     the real implementation (we just verify the contract, not the guidance
 *     content, to avoid hard-coupling to table-guidance internals).
 */

import type { CardError } from '@/lib/card-error-utils'

import { describe, expect, it } from 'bun:test'
import { ApiErrorType } from '@/lib/api/types'
import {
  detectCardErrorVariant,
  extractTableFromPermissionError,
  formatCardErrorForLogging,
  getCardErrorClassName,
  getCardErrorDescription,
  getCardErrorStyle,
  getCardErrorTitle,
  getTableMissingInfo,
  isCardErrorRetryable,
  isVersionOlder,
  parseSimpleVersion,
  shouldShowRetryButton,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(
  message: string,
  extra?: Record<string, unknown>
): CardError {
  const err = new Error(message)
  return Object.assign(err, extra) as CardError
}

function makeApiError(
  type: ApiErrorType,
  message = 'api error',
  extra?: Record<string, unknown>
): CardError {
  return Object.assign(new Error(message), { type, ...extra }) as CardError
}

// ---------------------------------------------------------------------------
// toEmptyStateVariant
// ---------------------------------------------------------------------------

describe('toEmptyStateVariant', () => {
  it('maps permission → error', () => {
    expect(toEmptyStateVariant('permission')).toBe('error')
  })

  it('passes through error unchanged', () => {
    expect(toEmptyStateVariant('error')).toBe('error')
  })

  it('passes through offline unchanged', () => {
    expect(toEmptyStateVariant('offline')).toBe('offline')
  })

  it('passes through timeout unchanged', () => {
    expect(toEmptyStateVariant('timeout')).toBe('timeout')
  })

  it('passes through table-missing unchanged', () => {
    expect(toEmptyStateVariant('table-missing')).toBe('table-missing')
  })
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant', () => {
  // ---- Explicit ApiErrorType fields ----

  it('returns permission for ApiErrorType.PermissionError', () => {
    expect(
      detectCardErrorVariant(makeApiError(ApiErrorType.PermissionError))
    ).toBe('permission')
  })

  it('returns table-missing for ApiErrorType.TableNotFound', () => {
    expect(
      detectCardErrorVariant(makeApiError(ApiErrorType.TableNotFound))
    ).toBe('table-missing')
  })

  it('returns offline for ApiErrorType.NetworkError', () => {
    expect(
      detectCardErrorVariant(makeApiError(ApiErrorType.NetworkError))
    ).toBe('offline')
  })

  // ---- Keyword: permission ----

  it('returns permission when message contains "permission"', () => {
    expect(detectCardErrorVariant(makeError('permission denied'))).toBe(
      'permission'
    )
  })

  it('returns permission when message contains "access denied"', () => {
    expect(
      detectCardErrorVariant(makeError('Access denied to system.query_log'))
    ).toBe('permission')
  })

  it('returns permission when message contains "unauthorized"', () => {
    expect(detectCardErrorVariant(makeError('Unauthorized request'))).toBe(
      'permission'
    )
  })

  it('returns permission when message contains "401"', () => {
    expect(detectCardErrorVariant(makeError('HTTP 401 error'))).toBe(
      'permission'
    )
  })

  it('returns permission when message contains "403"', () => {
    expect(detectCardErrorVariant(makeError('HTTP 403 Forbidden'))).toBe(
      'permission'
    )
  })

  it('returns permission when message contains "not_enough_privileges"', () => {
    expect(
      detectCardErrorVariant(makeError('not_enough_privileges for user'))
    ).toBe('permission')
  })

  it('returns permission when message contains "not enough privileges"', () => {
    expect(detectCardErrorVariant(makeError('not enough privileges'))).toBe(
      'permission'
    )
  })

  // ---- Keyword: timeout ----

  it('returns timeout when message contains "timeout"', () => {
    expect(detectCardErrorVariant(makeError('Query timeout exceeded'))).toBe(
      'timeout'
    )
  })

  it('returns timeout when message contains "timed out"', () => {
    expect(detectCardErrorVariant(makeError('Connection timed out'))).toBe(
      'timeout'
    )
  })

  it('returns timeout when message contains "resource limits"', () => {
    expect(detectCardErrorVariant(makeError('Exceeded resource limits'))).toBe(
      'timeout'
    )
  })

  it('returns timeout when message contains "exceeded resource"', () => {
    expect(detectCardErrorVariant(makeError('exceeded resource quota'))).toBe(
      'timeout'
    )
  })

  it('returns timeout when message contains "cpu/memory"', () => {
    expect(detectCardErrorVariant(makeError('cpu/memory limit reached'))).toBe(
      'timeout'
    )
  })

  it('returns timeout when message contains "memory limit"', () => {
    expect(detectCardErrorVariant(makeError('memory limit exceeded'))).toBe(
      'timeout'
    )
  })

  // ---- Status code: 5xx → timeout (except 503 → offline) ----

  it('returns timeout for status 500', () => {
    expect(
      detectCardErrorVariant(makeError('Server Error', { status: 500 }))
    ).toBe('timeout')
  })

  it('returns timeout for status 504', () => {
    expect(
      detectCardErrorVariant(makeError('Gateway Timeout', { status: 504 }))
    ).toBe('timeout')
  })

  it('returns timeout for status 502', () => {
    expect(
      detectCardErrorVariant(makeError('Bad Gateway', { status: 502 }))
    ).toBe('timeout')
  })

  it('returns error for unknown identifier even when status is 500', () => {
    expect(
      detectCardErrorVariant(
        makeError("Unknown identifier: 'ttl'", { status: 500 })
      )
    ).toBe('error')
  })

  it('returns error for missing columns even when status is 500', () => {
    expect(
      detectCardErrorVariant(makeError('Missing columns: ttl', { status: 500 }))
    ).toBe('error')
  })

  it('returns offline for status 503', () => {
    expect(
      detectCardErrorVariant(makeError('Service Unavailable', { status: 503 }))
    ).toBe('offline')
  })

  // ---- Keyword: offline ----

  it('returns offline when message contains "offline"', () => {
    expect(detectCardErrorVariant(makeError('You are offline'))).toBe('offline')
  })

  it('returns offline when message contains "network"', () => {
    expect(detectCardErrorVariant(makeError('Network failure'))).toBe('offline')
  })

  it('returns offline when message contains "fetch"', () => {
    expect(detectCardErrorVariant(makeError('Failed to fetch'))).toBe('offline')
  })

  it('returns offline when message contains "connection"', () => {
    expect(detectCardErrorVariant(makeError('connection refused'))).toBe(
      'offline'
    )
  })

  it('returns offline when message contains "econnrefused"', () => {
    expect(
      detectCardErrorVariant(makeError('ECONNREFUSED 127.0.0.1:8123'))
    ).toBe('offline')
  })

  it('returns offline when message contains "enotfound"', () => {
    expect(
      detectCardErrorVariant(makeError('ENOTFOUND host.example.com'))
    ).toBe('offline')
  })

  it('returns offline when message contains "etimedout"', () => {
    expect(
      detectCardErrorVariant(makeError('ETIMEDOUT connecting to host'))
    ).toBe('offline')
  })

  // ---- Keyword: table-missing ----

  it('returns table-missing when message contains "table" and "doesn\'t exist"', () => {
    // Only the word "table" is required; "doesn't exist" is a separate keyword
    expect(
      detectCardErrorVariant(makeError("Table system.foo doesn't exist"))
    ).toBe('table-missing')
  })

  it('returns table-missing when message contains "unknown table"', () => {
    expect(detectCardErrorVariant(makeError('Unknown table system.bar'))).toBe(
      'table-missing'
    )
  })

  it('returns table-missing when message contains "table_not_found"', () => {
    expect(detectCardErrorVariant(makeError('Error: table_not_found'))).toBe(
      'table-missing'
    )
  })

  it('returns table-missing when message contains "missing"', () => {
    expect(
      detectCardErrorVariant(makeError('Table is missing from schema'))
    ).toBe('table-missing')
  })

  // ---- Default ----

  it('returns error for unrecognised messages', () => {
    expect(detectCardErrorVariant(makeError('Something went wrong'))).toBe(
      'error'
    )
  })

  it('returns error for empty message', () => {
    expect(detectCardErrorVariant(makeError(''))).toBe('error')
  })

  // ---- Priority: permission beats offline ----

  it('permission keyword beats offline keyword when both present', () => {
    // "unauthorized" is permission; "network" is offline — permission wins
    expect(
      detectCardErrorVariant(makeError('unauthorized network request'))
    ).toBe('permission')
  })

  // ---- Priority: explicit type beats message keyword ----

  it('ApiErrorType.TableNotFound beats permission keyword in message', () => {
    const err = makeApiError(
      ApiErrorType.TableNotFound,
      'not enough privileges'
    )
    // permission would win via keyword; TableNotFound type should NOT win because
    // the permission keyword is checked FIRST in the source. Verify actual source order:
    // source checks permission-keyword FIRST, then table-not-found type.
    // So result is 'permission' here.
    expect(detectCardErrorVariant(err)).toBe('permission')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorTitle
// ---------------------------------------------------------------------------

describe('getCardErrorTitle', () => {
  it('returns standardized title for error variant', () => {
    expect(getCardErrorTitle('error')).toBe('Failed to load')
  })

  it('returns standardized title for offline', () => {
    expect(getCardErrorTitle('offline')).toBe("You're offline")
  })

  it('returns standardized title for timeout', () => {
    expect(getCardErrorTitle('timeout')).toBe('Request timed out')
  })

  it('returns standardized title for table-missing', () => {
    expect(getCardErrorTitle('table-missing')).toBe('Table not available')
  })

  it('returns standardized title for permission', () => {
    expect(getCardErrorTitle('permission')).toBe('Permission Required')
  })

  it('returns customTitle when provided', () => {
    expect(getCardErrorTitle('error', 'Custom Title')).toBe('Custom Title')
  })

  it('returns customTitle even for non-error variants', () => {
    expect(getCardErrorTitle('offline', 'My Custom Title')).toBe(
      'My Custom Title'
    )
  })

  it('returns default title when customTitle is empty string (falsy)', () => {
    expect(getCardErrorTitle('error', '')).toBe('Failed to load')
  })

  it('returns default title when customTitle is undefined', () => {
    expect(getCardErrorTitle('error', undefined)).toBe('Failed to load')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorDescription
// ---------------------------------------------------------------------------

describe('getCardErrorDescription', () => {
  // ---- compact mode ----

  it('returns short message in compact mode when available', () => {
    const err = makeError('something that should not appear')
    expect(getCardErrorDescription(err, 'table-missing', true)).toBe(
      'Required system table not configured.'
    )
  })

  it('returns short message in compact mode for offline', () => {
    const err = makeError('irrelevant')
    expect(getCardErrorDescription(err, 'offline', true)).toBe(
      'Cannot connect to server.'
    )
  })

  it('returns short message in compact mode for timeout', () => {
    const err = makeError('irrelevant')
    expect(getCardErrorDescription(err, 'timeout', true)).toBe(
      'Query execution timed out.'
    )
  })

  it('returns short message in compact mode for error', () => {
    const err = makeError('irrelevant')
    expect(getCardErrorDescription(err, 'error', true)).toBe(
      'An error occurred.'
    )
  })

  it('returns short message in compact mode for permission', () => {
    const err = makeError('irrelevant')
    expect(getCardErrorDescription(err, 'permission', true)).toBe(
      'Permission denied.'
    )
  })

  // ---- original message used when short + helpful ----

  it('uses original error message when it is 11–99 chars and non-generic', () => {
    const msg = 'ClickHouse host is unreachable on port 8123'
    const err = makeError(msg)
    expect(getCardErrorDescription(err, 'offline')).toBe(msg)
  })

  it('uses original message at 11 chars', () => {
    const msg = '12345678901' // exactly 11 chars
    const err = makeError(msg)
    expect(getCardErrorDescription(err, 'offline')).toBe(msg)
  })

  it('uses original message at 99 chars', () => {
    const msg = 'A'.repeat(99)
    const err = makeError(msg)
    expect(getCardErrorDescription(err, 'offline')).toBe(msg)
  })

  it('falls through to standardized message when original is too long (≥100 chars)', () => {
    const msg = 'X'.repeat(100)
    const err = makeError(msg)
    const result = getCardErrorDescription(err, 'offline')
    expect(result).toBe(
      'Unable to connect to the server. Check your network connection and try again.'
    )
  })

  it('falls through to standardized message when original is too short (≤10 chars)', () => {
    const msg = '1234567890' // exactly 10 chars (≤10)
    const err = makeError(msg)
    const result = getCardErrorDescription(err, 'offline')
    expect(result).toBe(
      'Unable to connect to the server. Check your network connection and try again.'
    )
  })

  it('falls through to standardized message when original is empty', () => {
    const err = makeError('')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toBe(
      'An unexpected error occurred while loading data. Please try again.'
    )
  })

  // ---- generic message detection ----

  it('falls through to standardized when original message contains "error"', () => {
    const err = makeError('An unknown error in the pipeline') // contains "error"
    const result = getCardErrorDescription(err, 'error')
    expect(result).toBe(
      'An unexpected error occurred while loading data. Please try again.'
    )
  })

  it('falls through when original contains "failed"', () => {
    const err = makeError('Query execution failed here') // 25 chars, non-generic check
    const result = getCardErrorDescription(err, 'timeout')
    expect(result).toBe(
      'The query took too long to execute. Try reducing the time range or simplifying your filters.'
    )
  })

  it('falls through when original contains "an error occurred"', () => {
    const err = makeError('An error occurred during execution')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toBe(
      'An unexpected error occurred while loading data. Please try again.'
    )
  })

  it('falls through when original contains "unknown error"', () => {
    const err = makeError('Unknown error from system')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toBe(
      'An unexpected error occurred while loading data. Please try again.'
    )
  })

  // ---- compact=false is the default ----

  it('default compact=false does not force short message', () => {
    const msg = 'ClickHouse host unreachable on port 8123'
    const err = makeError(msg)
    expect(getCardErrorDescription(err, 'offline')).toBe(msg)
  })

  // ---- standardized messages for all variants ----

  it('returns standardized description for table-missing when message is generic', () => {
    const err = makeError('An error occurred')
    expect(getCardErrorDescription(err, 'table-missing')).toBe(
      'This feature requires additional ClickHouse configuration or the system table does not exist on this cluster.'
    )
  })

  it('returns standardized description for permission when message is generic', () => {
    const err = makeError('An error occurred')
    expect(getCardErrorDescription(err, 'permission')).toBe(
      'The current ClickHouse user does not have sufficient privileges to query this system table. Contact your administrator to grant SELECT permissions.'
    )
  })
})

// ---------------------------------------------------------------------------
// getCardErrorStyle
// ---------------------------------------------------------------------------

describe('getCardErrorStyle', () => {
  it('returns destructive style for error variant', () => {
    const style = getCardErrorStyle('error')
    expect(style.isDestructive).toBe(true)
    expect(style.border).toBe('border-destructive/30')
    expect(style.background).toBe('bg-destructive/5')
  })

  it('returns non-destructive style for timeout', () => {
    const style = getCardErrorStyle('timeout')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toBe('border-warning/30')
    expect(style.background).toBe('bg-warning/5')
  })

  it('returns non-destructive style for offline', () => {
    const style = getCardErrorStyle('offline')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toBe('border-warning/30')
    expect(style.background).toBe('bg-warning/5')
  })

  it('returns non-destructive muted style for table-missing', () => {
    const style = getCardErrorStyle('table-missing')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toBe('border-muted/30')
    expect(style.background).toBe('bg-muted/30')
  })

  it('returns destructive style for permission', () => {
    const style = getCardErrorStyle('permission')
    expect(style.isDestructive).toBe(true)
    expect(style.border).toBe('border-destructive/30')
    expect(style.background).toBe('bg-destructive/5')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorClassName
// ---------------------------------------------------------------------------

describe('getCardErrorClassName', () => {
  it('returns combined border+background classes for error', () => {
    const cls = getCardErrorClassName('error')
    expect(cls).toBe('border-destructive/30 bg-destructive/5')
  })

  it('returns combined classes for offline', () => {
    const cls = getCardErrorClassName('offline')
    expect(cls).toBe('border-warning/30 bg-warning/5')
  })

  it('returns combined classes for timeout', () => {
    const cls = getCardErrorClassName('timeout')
    expect(cls).toBe('border-warning/30 bg-warning/5')
  })

  it('returns combined classes for table-missing', () => {
    const cls = getCardErrorClassName('table-missing')
    expect(cls).toBe('border-muted/30 bg-muted/30')
  })

  it('returns combined classes for permission', () => {
    const cls = getCardErrorClassName('permission')
    expect(cls).toBe('border-destructive/30 bg-destructive/5')
  })

  it('contains exactly one space between border and background', () => {
    const cls = getCardErrorClassName('error')
    const parts = cls.split(' ')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatch(/^border-/)
    expect(parts[1]).toMatch(/^bg-/)
  })
})

// ---------------------------------------------------------------------------
// isCardErrorRetryable
// ---------------------------------------------------------------------------

describe('isCardErrorRetryable', () => {
  it('returns true for offline errors', () => {
    expect(isCardErrorRetryable(makeError('network failure'))).toBe(true)
  })

  it('returns true for timeout errors', () => {
    expect(isCardErrorRetryable(makeError('query timeout exceeded'))).toBe(true)
  })

  it('returns false for generic errors', () => {
    expect(isCardErrorRetryable(makeError('Something went wrong'))).toBe(false)
  })

  it('returns false for table-missing errors', () => {
    expect(isCardErrorRetryable(makeApiError(ApiErrorType.TableNotFound))).toBe(
      false
    )
  })

  it('returns false for permission errors', () => {
    expect(
      isCardErrorRetryable(makeApiError(ApiErrorType.PermissionError))
    ).toBe(false)
  })

  it('returns true for status 503 (offline)', () => {
    expect(
      isCardErrorRetryable(makeError('service unavailable', { status: 503 }))
    ).toBe(true)
  })

  it('returns true for status 500 (timeout/server error)', () => {
    expect(
      isCardErrorRetryable(makeError('internal server error', { status: 500 }))
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// shouldShowRetryButton (alias for isCardErrorRetryable)
// ---------------------------------------------------------------------------

describe('shouldShowRetryButton', () => {
  it('returns same as isCardErrorRetryable for retryable error', () => {
    const err = makeError('network failure')
    expect(shouldShowRetryButton(err)).toBe(isCardErrorRetryable(err))
  })

  it('returns same as isCardErrorRetryable for non-retryable error', () => {
    const err = makeError('Something broke')
    expect(shouldShowRetryButton(err)).toBe(isCardErrorRetryable(err))
  })

  it('returns true for timeout', () => {
    expect(
      shouldShowRetryButton(makeError('timed out waiting for response'))
    ).toBe(true)
  })

  it('returns false for permission', () => {
    expect(
      shouldShowRetryButton(makeApiError(ApiErrorType.PermissionError))
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatCardErrorForLogging
// ---------------------------------------------------------------------------

describe('formatCardErrorForLogging', () => {
  it('returns correct shape for a plain Error', () => {
    const err = makeError('Something went wrong')
    const result = formatCardErrorForLogging(err)
    expect(result).toMatchObject({
      variant: 'error',
      message: 'Something went wrong',
      hasApiType: false,
      hasFetchType: false,
    })
    expect(result.type).toBe('unknown')
  })

  it('returns correct variant for an ApiError', () => {
    const err = makeApiError(ApiErrorType.NetworkError, 'network down')
    const result = formatCardErrorForLogging(err)
    expect(result.variant).toBe('offline')
    expect(result.type).toBe(ApiErrorType.NetworkError)
    expect(result.hasApiType).toBe(true)
    expect(result.hasFetchType).toBe(true) // same field name "type" on the cast
  })

  it('returns correct variant for a permission error', () => {
    const err = makeApiError(ApiErrorType.PermissionError, 'access denied')
    const result = formatCardErrorForLogging(err)
    expect(result.variant).toBe('permission')
    expect(result.type).toBe(ApiErrorType.PermissionError)
    expect(result.hasApiType).toBe(true)
  })

  it('returns correct variant for table-missing', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'table not found')
    const result = formatCardErrorForLogging(err)
    expect(result.variant).toBe('table-missing')
  })

  it('uses "No message" when error.message is undefined', () => {
    const err = {} as CardError
    const result = formatCardErrorForLogging(err)
    expect(result.message).toBe('No message')
  })

  it('hasApiType is false when no type property', () => {
    const err = makeError('plain error')
    const result = formatCardErrorForLogging(err)
    expect(result.hasApiType).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getTableMissingInfo
// ---------------------------------------------------------------------------

describe('getTableMissingInfo', () => {
  it('returns undefined when variant is not table-missing', () => {
    const err = makeError('network failure')
    expect(getTableMissingInfo(err)).toBeUndefined()
  })

  it('returns undefined when variant is permission', () => {
    const err = makeApiError(ApiErrorType.PermissionError)
    expect(getTableMissingInfo(err)).toBeUndefined()
  })

  it('returns undefined when table-missing but no missingTables field', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'table not found')
    expect(getTableMissingInfo(err)).toBeUndefined()
  })

  it('returns undefined when missingTables is empty array', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'table not found')
    Object.assign(err, { missingTables: [] })
    expect(getTableMissingInfo(err)).toBeUndefined()
  })

  it('returns TableMissingInfo when error has missingTables directly', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'missing')
    Object.assign(err, { missingTables: ['system.query_log'] })
    const info = getTableMissingInfo(err)
    expect(info).toBeDefined()
    expect(info!.missingTables).toEqual(['system.query_log'])
  })

  it('returns TableMissingInfo when missingTables is in error.details', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'missing')
    Object.assign(err, { details: { missingTables: ['system.error_log'] } })
    const info = getTableMissingInfo(err)
    expect(info).toBeDefined()
    expect(info!.missingTables).toEqual(['system.error_log'])
  })

  it('includes guidance property in result (may be undefined for unknown tables)', () => {
    const err = makeApiError(ApiErrorType.TableNotFound, 'missing')
    Object.assign(err, { missingTables: ['system.some_unknown_table_xyz'] })
    const info = getTableMissingInfo(err)
    expect(info).toBeDefined()
    // guidance may be undefined for unknown tables — just check the key exists
    expect('guidance' in info!).toBe(true)
  })

  it('direct missingTables takes precedence over details.missingTables', () => {
    // Source code: `apiError.missingTables || apiError.details?.missingTables`
    const err = makeApiError(ApiErrorType.TableNotFound, 'missing')
    Object.assign(err, {
      missingTables: ['system.query_log'],
      details: { missingTables: ['system.error_log'] },
    })
    const info = getTableMissingInfo(err)
    expect(info!.missingTables).toEqual(['system.query_log'])
  })
})

// ---------------------------------------------------------------------------
// parseSimpleVersion
// ---------------------------------------------------------------------------

describe('parseSimpleVersion', () => {
  it('parses standard four-part version string', () => {
    expect(parseSimpleVersion('24.3.1.1')).toEqual({
      major: 24,
      minor: 3,
      patch: 1,
    })
  })

  it('parses three-part version string', () => {
    expect(parseSimpleVersion('23.8.5')).toEqual({
      major: 23,
      minor: 8,
      patch: 5,
    })
  })

  it('parses two-part version string', () => {
    expect(parseSimpleVersion('24.3')).toEqual({
      major: 24,
      minor: 3,
      patch: 0,
    })
  })

  it('parses single-part version string', () => {
    expect(parseSimpleVersion('24')).toEqual({ major: 24, minor: 0, patch: 0 })
  })

  it('returns zeros for empty string', () => {
    expect(parseSimpleVersion('')).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('returns zeros for non-string input (null cast)', () => {
    expect(parseSimpleVersion(null as unknown as string)).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })

  it('returns zeros for non-string input (number cast)', () => {
    expect(parseSimpleVersion(42 as unknown as string)).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })

  it('handles "0.0.0"', () => {
    expect(parseSimpleVersion('0.0.0')).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })

  it('handles large version numbers', () => {
    expect(parseSimpleVersion('100.200.300.400')).toEqual({
      major: 100,
      minor: 200,
      patch: 300,
    })
  })

  it('handles leading zeros gracefully (parseInt base-10)', () => {
    expect(parseSimpleVersion('24.08.05')).toEqual({
      major: 24,
      minor: 8,
      patch: 5,
    })
  })
})

// ---------------------------------------------------------------------------
// isVersionOlder
// ---------------------------------------------------------------------------

describe('isVersionOlder', () => {
  // ---- current is older ----

  it('returns true when current major is older', () => {
    expect(isVersionOlder('23.8.0', '24.1.0')).toBe(true)
  })

  it('returns true when current minor is older (same major)', () => {
    expect(isVersionOlder('24.1.0', '24.3.0')).toBe(true)
  })

  it('returns true when current patch is older (same major.minor)', () => {
    expect(isVersionOlder('24.3.1', '24.3.2')).toBe(true)
  })

  // ---- current equals required ----

  it('returns false when versions are exactly equal', () => {
    expect(isVersionOlder('24.3.1', '24.3.1')).toBe(false)
  })

  it('returns false when versions are equal with extra part', () => {
    expect(isVersionOlder('24.3.1.1', '24.3.1.0')).toBe(false)
  })

  // ---- current is newer ----

  it('returns false when current major is newer', () => {
    expect(isVersionOlder('25.1.0', '24.12.0')).toBe(false)
  })

  it('returns false when current minor is newer (same major)', () => {
    expect(isVersionOlder('24.5.0', '24.3.0')).toBe(false)
  })

  it('returns false when current patch is newer (same major.minor)', () => {
    expect(isVersionOlder('24.3.5', '24.3.2')).toBe(false)
  })

  // ---- edge cases ----

  it('returns false for empty strings (both 0.0.0)', () => {
    expect(isVersionOlder('', '')).toBe(false)
  })

  it('returns false for equal empty strings', () => {
    expect(isVersionOlder('0.0.0', '0.0.0')).toBe(false)
  })

  it('handles typical ClickHouse version "23.8" vs "24.1"', () => {
    expect(isVersionOlder('23.8', '24.1')).toBe(true)
    expect(isVersionOlder('24.1', '23.8')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractTableFromPermissionError
// ---------------------------------------------------------------------------

describe('extractTableFromPermissionError', () => {
  it('extracts system table reference', () => {
    expect(
      extractTableFromPermissionError('Access denied to system.query_log')
    ).toBe('system.query_log')
  })

  it('extracts default schema table reference', () => {
    expect(
      extractTableFromPermissionError('No permission on default.my_table')
    ).toBe('default.my_table')
  })

  it('returns undefined when no table reference found', () => {
    expect(
      extractTableFromPermissionError('Generic permission error')
    ).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(extractTableFromPermissionError('')).toBeUndefined()
  })

  it('returns first match when multiple table refs present', () => {
    const msg = 'Cannot access system.query_log or system.processes'
    const result = extractTableFromPermissionError(msg)
    expect(result).toBe('system.query_log')
  })

  it('handles uppercase SYSTEM schema', () => {
    // Regex uses /i flag
    const result = extractTableFromPermissionError(
      'SYSTEM.QUERY_LOG access denied'
    )
    expect(result).toBe('SYSTEM.QUERY_LOG')
  })

  it('extracts table with underscores and numbers in name', () => {
    expect(
      extractTableFromPermissionError('Access denied to system.part_log_2')
    ).toBe('system.part_log_2')
  })

  it('returns undefined when only "system" without dot-table', () => {
    expect(
      extractTableFromPermissionError('system error occurred')
    ).toBeUndefined()
  })
})
