import {
  ADVISOR_NO_TARGET_TABLE_MESSAGE,
  findAdvisorTargetTable,
  isAdvisorUserInputError,
} from './advisor-errors'
import { describe, expect, test } from 'bun:test'

describe('findAdvisorTargetTable', () => {
  test('SELECT 1 has no target table', () => {
    const result = findAdvisorTargetTable('select 1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('no_target_table')
      expect(result.error).toBe(ADVISOR_NO_TARGET_TABLE_MESSAGE)
    }
  })

  test('SELECT now() has no target table', () => {
    const result = findAdvisorTargetTable('SELECT now()')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_target_table')
  })

  test('SELECT with FROM returns the table', () => {
    const result = findAdvisorTargetTable(
      "SELECT * FROM events WHERE status = 'error'",
      'default'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.table.qualifiedName).toBe('default.events')
    }
  })
})

describe('isAdvisorUserInputError', () => {
  test('classifies input issues vs schema failures', () => {
    expect(isAdvisorUserInputError('no_target_table')).toBe(true)
    expect(isAdvisorUserInputError('query_not_found')).toBe(true)
    expect(isAdvisorUserInputError('invalid_sql')).toBe(true)
    expect(isAdvisorUserInputError('missing_input')).toBe(true)
    expect(isAdvisorUserInputError('schema_unavailable')).toBe(false)
    expect(isAdvisorUserInputError(undefined)).toBe(false)
  })
})
