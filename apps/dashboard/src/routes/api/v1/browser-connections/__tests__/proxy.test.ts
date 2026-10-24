/**
 * Tests for browser-connections/proxy SQL validation
 *
 * Verifies that the proxy endpoint's SQL validation gate works correctly.
 *
 * Since bun:test mock.module is process-global and shared-mocks.ts already
 * mocks @chm/sql-builder as a no-op for AI agent tests, we cannot reliably
 * test through the route module in the full suite. Instead, we:
 *
 * 1. Structurally verify the proxy source imports and calls validateSqlQuery
 * 2. Behaviorally verify the real validateSqlQuery rejects DDL/DML
 *
 * The full behavioral coverage lives in:
 *   packages/sql-builder/src/__tests__/sql-validator.test.ts
 */

// Import the real validator by file path, not the '@chm/sql-builder' barrel:
// shared-mocks.ts replaces the barrel with a no-op for the whole process, but
// does not touch this module, so these tests always run the real function.
import { validateSqlQuery } from '../../../../../../../../packages/sql-builder/src/sql-validator'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROXY_SOURCE = readFileSync(
  join((import.meta as any).dir, '..', 'proxy.ts'),
  'utf-8'
)

describe('browser-connections proxy SQL validation (structural)', () => {
  test('proxy.ts imports validateSqlQuery from @chm/sql-builder', () => {
    expect(PROXY_SOURCE).toContain(
      "import { validateSqlQuery } from '@chm/sql-builder'"
    )
  })

  test('proxy.ts calls validateSqlQuery(query) in a try/catch', () => {
    expect(PROXY_SOURCE).toMatch(/try\s*\{[\s\S]*?validateSqlQuery\(query\)/)
  })

  test('proxy.ts returns validation error when validateSqlQuery throws', () => {
    expect(PROXY_SOURCE).toContain('SQL validation failed')
  })

  test('proxy.ts has SECURITY comment before the validation block', () => {
    expect(PROXY_SOURCE).toContain('// SECURITY: Validate SQL query')
  })
})

describe('validateSqlQuery rejects DDL/DML (behavioral)', () => {
  test('rejects DROP TABLE', () => {
    expect(() => validateSqlQuery('DROP TABLE users')).toThrow(/dangerous SQL/)
  })

  test('rejects DELETE FROM', () => {
    expect(() =>
      validateSqlQuery('DELETE FROM system.query_log WHERE 1=1')
    ).toThrow(/dangerous SQL/)
  })

  test('rejects INSERT INTO', () => {
    expect(() =>
      validateSqlQuery('INSERT INTO users VALUES (1, "admin")')
    ).toThrow(/dangerous SQL/)
  })

  test('allows SELECT', () => {
    expect(() => validateSqlQuery('SELECT 1')).not.toThrow()
  })
})
