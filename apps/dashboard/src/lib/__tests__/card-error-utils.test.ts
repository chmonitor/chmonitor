import { describe, expect, test } from 'bun:test'
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
// toEmptyStateVariant
// ---------------------------------------------------------------------------

describe('toEmptyStateVariant', () => {
  test('maps permission to error', () => {
    expect(toEmptyStateVariant('permission')).toBe('error')
  })

  test('passes through all other variants unchanged', () => {
    expect(toEmptyStateVariant('error')).toBe('error')
    expect(toEmptyStateVariant('offline')).toBe('offline')
    expect(toEmptyStateVariant('timeout')).toBe('timeout')
    expect(toEmptyStateVariant('table-missing')).toBe('table-missing')
  })
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — explicit type fields
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — ApiErrorType fields', () => {
  test('returns permission for ApiErrorType.PermissionError', () => {
    const err = { type: ApiErrorType.PermissionError, message: '' }
    expect(detectCardErrorVariant(err as any)).toBe('permission')
  })

  test('returns table-missing for ApiErrorType.TableNotFound', () => {
    const err = { type: ApiErrorType.TableNotFound, message: '' }
    expect(detectCardErrorVariant(err as any)).toBe('table-missing')
  })

  test('returns offline for ApiErrorType.NetworkError', () => {
    const err = { type: ApiErrorType.NetworkError, message: '' }
    expect(detectCardErrorVariant(err as any)).toBe('offline')
  })

  test('explicit type fields take priority over message keywords', () => {
    // TableNotFound type but message says "connection" — type wins
    const err = {
      type: ApiErrorType.TableNotFound,
      message: 'connection refused',
    }
    expect(detectCardErrorVariant(err as any)).toBe('table-missing')
  })
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — permission keyword detection
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — permission keywords', () => {
  const permissionKeywords = [
    'permission denied',
    'access denied',
    'unauthorized',
    '401 error',
    '403 forbidden',
    'not_enough_privileges',
    'not enough privileges',
  ]

  for (const msg of permissionKeywords) {
    test(`detects permission from message: "${msg}"`, () => {
      expect(detectCardErrorVariant(new Error(msg))).toBe('permission')
    })
  }
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — timeout keywords
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — timeout keywords', () => {
  const timeoutMessages = [
    'timeout exceeded',
    'query timed out',
    'query timeout',
    'resource limits exceeded',
    'exceeded resource',
    'cpu/memory limit hit',
    'memory limit exceeded',
  ]

  for (const msg of timeoutMessages) {
    test(`detects timeout from message: "${msg}"`, () => {
      expect(detectCardErrorVariant(new Error(msg))).toBe('timeout')
    })
  }
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — offline keywords
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — offline keywords', () => {
  const offlineMessages = [
    'offline',
    'network error',
    'fetch failed',
    'connection refused',
    'ECONNREFUSED: connect failed',
    'ENOTFOUND: host not found',
    'ETIMEDOUT: econnrefused',
  ]

  for (const msg of offlineMessages) {
    test(`detects offline from message: "${msg}"`, () => {
      expect(detectCardErrorVariant(new Error(msg))).toBe('offline')
    })
  }
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — table-missing keywords
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — table-missing keywords', () => {
  test('detects table missing from "doesn\'t exist" message', () => {
    expect(detectCardErrorVariant(new Error("table doesn't exist"))).toBe(
      'table-missing'
    )
  })

  test('detects table missing from "unknown table" message', () => {
    expect(detectCardErrorVariant(new Error('unknown table system.foo'))).toBe(
      'table-missing'
    )
  })

  test('detects table missing from "table_not_found" message', () => {
    expect(detectCardErrorVariant(new Error('table_not_found error'))).toBe(
      'table-missing'
    )
  })

  test('detects table missing from "missing" message', () => {
    expect(detectCardErrorVariant(new Error('table is missing'))).toBe(
      'table-missing'
    )
  })
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — HTTP status codes
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — HTTP status codes', () => {
  test('5xx (non-503) returns timeout', () => {
    expect(detectCardErrorVariant({ message: '', status: 500 } as any)).toBe(
      'timeout'
    )
    expect(detectCardErrorVariant({ message: '', status: 502 } as any)).toBe(
      'timeout'
    )
    expect(detectCardErrorVariant({ message: '', status: 504 } as any)).toBe(
      'timeout'
    )
  })

  test('unknown identifier / missing columns stay errors even on HTTP 500', () => {
    expect(
      detectCardErrorVariant({
        message: "Unknown identifier: 'ttl'",
        status: 500,
      } as any)
    ).toBe('error')
    expect(
      detectCardErrorVariant({
        message: 'Missing columns: ttl',
        status: 500,
      } as any)
    ).toBe('error')
  })

  test('503 returns offline', () => {
    expect(detectCardErrorVariant({ message: '', status: 503 } as any)).toBe(
      'offline'
    )
  })

  test('4xx does not trigger status-based classification', () => {
    // 404 should fall through to generic 'error'
    expect(detectCardErrorVariant({ message: '', status: 404 } as any)).toBe(
      'error'
    )
  })
})

// ---------------------------------------------------------------------------
// detectCardErrorVariant — default fallback
// ---------------------------------------------------------------------------

describe('detectCardErrorVariant — default', () => {
  test('returns error for unrecognized message', () => {
    expect(detectCardErrorVariant(new Error('something went wrong'))).toBe(
      'error'
    )
  })

  test('handles missing message gracefully', () => {
    expect(detectCardErrorVariant({ message: undefined } as any)).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorTitle
// ---------------------------------------------------------------------------

describe('getCardErrorTitle', () => {
  test('returns standard title for each variant', () => {
    expect(getCardErrorTitle('error')).toBe('Failed to load')
    expect(getCardErrorTitle('offline')).toBe("You're offline")
    expect(getCardErrorTitle('timeout')).toBe('Request timed out')
    expect(getCardErrorTitle('table-missing')).toBe('Table not available')
    expect(getCardErrorTitle('permission')).toBe('Permission Required')
  })

  test('custom title overrides default', () => {
    expect(getCardErrorTitle('error', 'Custom Title')).toBe('Custom Title')
  })

  test('empty string custom title falls back to default', () => {
    expect(getCardErrorTitle('error', '')).toBe('Failed to load')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorDescription
// ---------------------------------------------------------------------------

describe('getCardErrorDescription', () => {
  test('returns compact short message when compact=true and short is defined', () => {
    const err = new Error('x')
    expect(getCardErrorDescription(err, 'error', true)).toBe(
      'An error occurred.'
    )
    expect(getCardErrorDescription(err, 'offline', true)).toBe(
      'Cannot connect to server.'
    )
    expect(getCardErrorDescription(err, 'timeout', true)).toBe(
      'Query execution timed out.'
    )
    expect(getCardErrorDescription(err, 'table-missing', true)).toBe(
      'Required system table not configured.'
    )
    expect(getCardErrorDescription(err, 'permission', true)).toBe(
      'Permission denied.'
    )
  })

  test('returns original message when non-generic and 10 < length < 100', () => {
    const err = new Error('Connection to 10.0.0.1:9000 refused')
    const result = getCardErrorDescription(err, 'offline')
    expect(result).toBe('Connection to 10.0.0.1:9000 refused')
  })

  test('falls back to standardized description when message is generic', () => {
    const err = new Error('An error occurred')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toBe(
      'An unexpected error occurred while loading data. Please try again.'
    )
  })

  test('falls back to standardized description when message is too short (<=10 chars)', () => {
    const err = new Error('oops')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toContain('unexpected error')
  })

  test('falls back to standardized description when message is too long (>=100 chars)', () => {
    const longMsg = 'a'.repeat(101)
    const err = new Error(longMsg)
    const result = getCardErrorDescription(err, 'error')
    expect(result).toContain('unexpected error')
  })

  test('falls back to standardized when message contains "failed"', () => {
    const err = new Error('Something has failed badly')
    const result = getCardErrorDescription(err, 'error')
    expect(result).toContain('unexpected error')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorStyle
// ---------------------------------------------------------------------------

describe('getCardErrorStyle', () => {
  test('error variant is destructive', () => {
    const style = getCardErrorStyle('error')
    expect(style.isDestructive).toBe(true)
    expect(style.border).toContain('destructive')
    expect(style.background).toContain('destructive')
  })

  test('permission variant is destructive', () => {
    const style = getCardErrorStyle('permission')
    expect(style.isDestructive).toBe(true)
  })

  test('timeout variant is not destructive', () => {
    const style = getCardErrorStyle('timeout')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toContain('warning')
  })

  test('offline variant is not destructive', () => {
    const style = getCardErrorStyle('offline')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toContain('warning')
  })

  test('table-missing variant is not destructive', () => {
    const style = getCardErrorStyle('table-missing')
    expect(style.isDestructive).toBe(false)
    expect(style.border).toContain('muted')
  })
})

// ---------------------------------------------------------------------------
// getCardErrorClassName
// ---------------------------------------------------------------------------

describe('getCardErrorClassName', () => {
  test('returns a string combining border and background classes', () => {
    const cls = getCardErrorClassName('error')
    expect(cls).toContain('border-destructive')
    expect(cls).toContain('bg-destructive')
  })

  test('offline includes warning classes', () => {
    const cls = getCardErrorClassName('offline')
    expect(cls).toContain('warning')
  })
})

// ---------------------------------------------------------------------------
// isCardErrorRetryable / shouldShowRetryButton
// ---------------------------------------------------------------------------

describe('isCardErrorRetryable', () => {
  test('offline errors are retryable', () => {
    expect(isCardErrorRetryable(new Error('connection refused'))).toBe(true)
  })

  test('timeout errors are retryable', () => {
    expect(isCardErrorRetryable(new Error('timeout exceeded'))).toBe(true)
  })

  test('permission errors are not retryable', () => {
    expect(isCardErrorRetryable(new Error('access denied'))).toBe(false)
  })

  test('table-missing errors are not retryable', () => {
    expect(isCardErrorRetryable(new Error("table doesn't exist"))).toBe(false)
  })

  test('generic errors are not retryable', () => {
    expect(isCardErrorRetryable(new Error('something went wrong'))).toBe(false)
  })
})

describe('shouldShowRetryButton', () => {
  test('is equivalent to isCardErrorRetryable', () => {
    const err = new Error('network error')
    expect(shouldShowRetryButton(err)).toBe(isCardErrorRetryable(err))
  })
})

// ---------------------------------------------------------------------------
// formatCardErrorForLogging
// ---------------------------------------------------------------------------

describe('formatCardErrorForLogging', () => {
  test('formats a plain Error', () => {
    const result = formatCardErrorForLogging(new Error('oops'))
    expect(result.variant).toBe('error')
    expect(result.type).toBe('unknown')
    expect(result.message).toBe('oops')
    expect(result.hasApiType).toBe(false)
    expect(result.hasFetchType).toBe(false)
  })

  test('extracts type from ApiError-shaped object', () => {
    const err = { type: ApiErrorType.NetworkError, message: 'down' }
    const result = formatCardErrorForLogging(err as any)
    expect(result.variant).toBe('offline')
    expect(result.type).toBe('network_error')
    expect(result.hasApiType).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getTableMissingInfo
// ---------------------------------------------------------------------------

describe('getTableMissingInfo', () => {
  test('returns undefined for non-table-missing errors', () => {
    expect(getTableMissingInfo(new Error('connection refused'))).toBeUndefined()
    expect(getTableMissingInfo(new Error('access denied'))).toBeUndefined()
  })

  test('returns undefined for table-missing error with no missingTables', () => {
    const err = { type: ApiErrorType.TableNotFound, message: '' }
    expect(getTableMissingInfo(err as any)).toBeUndefined()
  })

  test('extracts missingTables from error.missingTables', () => {
    const err = {
      type: ApiErrorType.TableNotFound,
      message: '',
      missingTables: ['system.query_log'],
    }
    const info = getTableMissingInfo(err as any)
    expect(info).toBeDefined()
    expect(info!.missingTables).toEqual(['system.query_log'])
  })

  test('extracts missingTables from error.details.missingTables', () => {
    const err = {
      type: ApiErrorType.TableNotFound,
      message: '',
      details: { missingTables: ['system.backup_log'] },
    }
    const info = getTableMissingInfo(err as any)
    expect(info).toBeDefined()
    expect(info!.missingTables).toEqual(['system.backup_log'])
  })
})

// ---------------------------------------------------------------------------
// parseSimpleVersion
// ---------------------------------------------------------------------------

describe('parseSimpleVersion', () => {
  test('parses standard ClickHouse version string', () => {
    expect(parseSimpleVersion('24.3.1.1')).toEqual({
      major: 24,
      minor: 3,
      patch: 1,
    })
    expect(parseSimpleVersion('23.8.12.0')).toEqual({
      major: 23,
      minor: 8,
      patch: 12,
    })
  })

  test('handles short version strings', () => {
    expect(parseSimpleVersion('24.3')).toEqual({
      major: 24,
      minor: 3,
      patch: 0,
    })
    expect(parseSimpleVersion('24')).toEqual({ major: 24, minor: 0, patch: 0 })
  })

  test('returns zeroes for empty or invalid input', () => {
    expect(parseSimpleVersion('')).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(parseSimpleVersion(null as any)).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// isVersionOlder
// ---------------------------------------------------------------------------

describe('isVersionOlder', () => {
  test('returns false when versions are equal', () => {
    expect(isVersionOlder('24.3.1', '24.3.1')).toBe(false)
  })

  test('detects older major version', () => {
    expect(isVersionOlder('23.8.0', '24.0.0')).toBe(true)
  })

  test('detects newer major version', () => {
    expect(isVersionOlder('25.1.0', '24.8.0')).toBe(false)
  })

  test('compares minor versions when major is equal', () => {
    expect(isVersionOlder('24.2.5', '24.3.0')).toBe(true)
    expect(isVersionOlder('24.4.0', '24.3.9')).toBe(false)
  })

  test('compares patch versions when major and minor are equal', () => {
    expect(isVersionOlder('24.3.1', '24.3.2')).toBe(true)
    expect(isVersionOlder('24.3.3', '24.3.2')).toBe(false)
  })

  test('returns false on invalid input', () => {
    expect(isVersionOlder('bad', 'worse')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractTableFromPermissionError
// ---------------------------------------------------------------------------

describe('extractTableFromPermissionError', () => {
  test('extracts system.* table names', () => {
    expect(
      extractTableFromPermissionError('Access to system.query_log is denied')
    ).toBe('system.query_log')
  })

  test('extracts default.* table names', () => {
    expect(
      extractTableFromPermissionError('No access to default.my_table')
    ).toBe('default.my_table')
  })

  test('returns undefined when no table name found', () => {
    expect(extractTableFromPermissionError('generic error')).toBeUndefined()
  })

  test('handles empty string', () => {
    expect(extractTableFromPermissionError('')).toBeUndefined()
  })
})
