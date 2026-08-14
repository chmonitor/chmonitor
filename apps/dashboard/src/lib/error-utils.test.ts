import type { FetchDataError } from '@chm/clickhouse-client'

import {
  formatErrorMessage,
  formatErrorTitle,
  getErrorDocumentation,
  getErrorVariant,
  shouldDisplayError,
} from './error-utils'
import { describe, expect, it } from 'bun:test'

// Helper to build a minimal FetchDataError
function mkError(
  type: FetchDataError['type'],
  message = 'some error',
  details?: FetchDataError['details']
): FetchDataError {
  return { type, message, details }
}

// ─── formatErrorMessage ───────────────────────────────────────────────────────

describe('formatErrorMessage', () => {
  it('column_not_found — lists missing columns', () => {
    const err = mkError('column_not_found', 'missing', {
      missingColumns: [
        'system.metric_log.CurrentMetric_ReplicasMaxAbsoluteDelay',
      ],
    })
    const result = formatErrorMessage(err)
    expect(result).toContain(
      'Required columns not found: system.metric_log.CurrentMetric_ReplicasMaxAbsoluteDelay'
    )
  })

  it('table_not_found — no missingTables → generic message + docs link', () => {
    const err = mkError('table_not_found', 'missing')
    const result = formatErrorMessage(err)
    expect(result).toContain('Required tables not found.')
    expect(result).toContain(
      'https://docs.chmonitor.dev/getting-started/clickhouse-enable-system-tables'
    )
    // must NOT contain the "Required tables not found: X" variant
    expect(result).not.toMatch(/Required tables not found: \w/)
  })

  it('table_not_found — empty missingTables array → generic message', () => {
    const err = mkError('table_not_found', 'missing', { missingTables: [] })
    const result = formatErrorMessage(err)
    expect(result).toContain('Required tables not found.')
    expect(result).not.toMatch(/Required tables not found: \w/)
  })

  it('table_not_found — single missing table → lists table name', () => {
    const err = mkError('table_not_found', 'missing', {
      missingTables: ['system.backup_log'],
    })
    const result = formatErrorMessage(err)
    expect(result).toBe(
      'Required tables not found: system.backup_log. Checkout https://docs.chmonitor.dev/getting-started/clickhouse-enable-system-tables'
    )
  })

  it('table_not_found — multiple missing tables → comma-separated list', () => {
    const err = mkError('table_not_found', 'missing', {
      missingTables: ['system.backup_log', 'system.error_log'],
    })
    const result = formatErrorMessage(err)
    expect(result).toContain('system.backup_log, system.error_log')
    expect(result).toMatch(/^Required tables not found: /)
  })

  it('permission_error → fixed message', () => {
    const result = formatErrorMessage(mkError('permission_error'))
    expect(result).toBe(
      'Permission denied. Please check your ClickHouse user permissions.'
    )
  })

  it('network_error → fixed message', () => {
    const result = formatErrorMessage(mkError('network_error'))
    expect(result).toBe(
      'Network connection error. Please check your ClickHouse server connectivity.'
    )
  })

  it('validation_error → includes error.message', () => {
    const result = formatErrorMessage(
      mkError('validation_error', 'bad parameter')
    )
    expect(result).toBe('Validation error: bad parameter')
  })

  it('query_error (default) → returns raw message', () => {
    const result = formatErrorMessage(mkError('query_error', 'syntax error'))
    expect(result).toBe('syntax error')
  })

  it('ssl_error (default) → returns raw message', () => {
    const result = formatErrorMessage(mkError('ssl_error', 'cert expired'))
    expect(result).toBe('cert expired')
  })

  it('timeout_error (default) → returns raw message', () => {
    const result = formatErrorMessage(mkError('timeout_error', 'timed out'))
    expect(result).toBe('timed out')
  })
})

// ─── formatErrorTitle ─────────────────────────────────────────────────────────

describe('formatErrorTitle', () => {
  it('column_not_found → "Column Not Found"', () => {
    expect(formatErrorTitle(mkError('column_not_found'))).toBe(
      'Column Not Found'
    )
  })

  it('table_not_found → "Table Not Found"', () => {
    expect(formatErrorTitle(mkError('table_not_found'))).toBe('Table Not Found')
  })

  it('permission_error → "Permission Denied"', () => {
    expect(formatErrorTitle(mkError('permission_error'))).toBe(
      'Permission Denied'
    )
  })

  it('network_error → "Connection Error"', () => {
    expect(formatErrorTitle(mkError('network_error'))).toBe('Connection Error')
  })

  it('validation_error → "Validation Error"', () => {
    expect(formatErrorTitle(mkError('validation_error'))).toBe(
      'Validation Error'
    )
  })

  it('query_error (default) → "Query Error"', () => {
    expect(formatErrorTitle(mkError('query_error'))).toBe('Query Error')
  })

  it('ssl_error (default) → "Query Error"', () => {
    expect(formatErrorTitle(mkError('ssl_error'))).toBe('Query Error')
  })

  it('timeout_error (default) → "Query Error"', () => {
    expect(formatErrorTitle(mkError('timeout_error'))).toBe('Query Error')
  })
})

// ─── shouldDisplayError ───────────────────────────────────────────────────────

describe('shouldDisplayError', () => {
  it('column_not_found → false (silent)', () => {
    expect(shouldDisplayError(mkError('column_not_found'))).toBe(false)
  })

  it('table_not_found → false (silent)', () => {
    expect(shouldDisplayError(mkError('table_not_found'))).toBe(false)
  })

  it('permission_error → true', () => {
    expect(shouldDisplayError(mkError('permission_error'))).toBe(true)
  })

  it('network_error → true', () => {
    expect(shouldDisplayError(mkError('network_error'))).toBe(true)
  })

  it('validation_error → true', () => {
    expect(shouldDisplayError(mkError('validation_error'))).toBe(true)
  })

  it('query_error → true', () => {
    expect(shouldDisplayError(mkError('query_error'))).toBe(true)
  })

  it('ssl_error → true', () => {
    expect(shouldDisplayError(mkError('ssl_error'))).toBe(true)
  })

  it('timeout_error → true', () => {
    expect(shouldDisplayError(mkError('timeout_error'))).toBe(true)
  })
})

// ─── getErrorDocumentation ────────────────────────────────────────────────────

describe('getErrorDocumentation', () => {
  it('table_not_found — backup_log → backup docs', () => {
    const err = mkError('table_not_found', '', {
      missingTables: ['system.backup_log'],
    })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain('Backup logging is not enabled')
    expect(doc).toContain('https://clickhouse.com/docs/operations/backup')
  })

  it('table_not_found — error_log → error_log docs', () => {
    const err = mkError('table_not_found', '', {
      missingTables: ['system.error_log'],
    })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain('Error logging is not enabled')
    expect(doc).toContain('error_log')
  })

  it('table_not_found — zookeeper → zookeeper docs', () => {
    const err = mkError('table_not_found', '', {
      missingTables: ['system.zookeeper'],
    })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain('ZooKeeper is not configured')
    expect(doc).toContain('replication')
  })

  it('table_not_found — unknown table → generic docs', () => {
    const err = mkError('table_not_found', '', {
      missingTables: ['system.some_unknown_table'],
    })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain(
      'This feature requires specific ClickHouse configuration'
    )
    expect(doc).toContain(
      'https://docs.chmonitor.dev/getting-started/clickhouse-enable-system-tables'
    )
  })

  it('table_not_found — no details → generic docs', () => {
    const err = mkError('table_not_found', '')
    const doc = getErrorDocumentation(err)
    expect(doc).toContain(
      'This feature requires specific ClickHouse configuration'
    )
  })

  it('table_not_found — empty missingTables → generic docs', () => {
    const err = mkError('table_not_found', '', { missingTables: [] })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain(
      'This feature requires specific ClickHouse configuration'
    )
  })

  it('table_not_found — backup_log checked before error_log when both present', () => {
    // backup_log check comes first in the switch; both present → backup message
    const err = mkError('table_not_found', '', {
      missingTables: ['system.backup_log', 'system.error_log'],
    })
    const doc = getErrorDocumentation(err)
    expect(doc).toContain('Backup logging is not enabled')
  })

  it('permission_error → grant-permissions message', () => {
    const doc = getErrorDocumentation(mkError('permission_error'))
    expect(doc).toContain('Grant required permissions')
  })

  it('network_error (default) → null', () => {
    expect(getErrorDocumentation(mkError('network_error'))).toBeNull()
  })

  it('validation_error (default) → null', () => {
    expect(getErrorDocumentation(mkError('validation_error'))).toBeNull()
  })

  it('query_error (default) → null', () => {
    expect(getErrorDocumentation(mkError('query_error'))).toBeNull()
  })

  it('ssl_error (default) → null', () => {
    expect(getErrorDocumentation(mkError('ssl_error'))).toBeNull()
  })

  it('timeout_error (default) → null', () => {
    expect(getErrorDocumentation(mkError('timeout_error'))).toBeNull()
  })
})

// ─── getErrorVariant ──────────────────────────────────────────────────────────

describe('getErrorVariant', () => {
  it('table_not_found → "warning"', () => {
    expect(getErrorVariant(mkError('table_not_found'))).toBe('warning')
  })

  it('permission_error → "destructive"', () => {
    expect(getErrorVariant(mkError('permission_error'))).toBe('destructive')
  })

  it('network_error → "info"', () => {
    expect(getErrorVariant(mkError('network_error'))).toBe('info')
  })

  it('validation_error → "warning"', () => {
    expect(getErrorVariant(mkError('validation_error'))).toBe('warning')
  })

  it('query_error (default) → "destructive"', () => {
    expect(getErrorVariant(mkError('query_error'))).toBe('destructive')
  })

  it('ssl_error (default) → "destructive"', () => {
    expect(getErrorVariant(mkError('ssl_error'))).toBe('destructive')
  })

  it('timeout_error (default) → "destructive"', () => {
    expect(getErrorVariant(mkError('timeout_error'))).toBe('destructive')
  })
})
