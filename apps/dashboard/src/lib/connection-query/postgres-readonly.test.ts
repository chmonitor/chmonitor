import { describe, expect, test } from 'bun:test'
import {
  assertReadOnlyStatement,
  formatPostgresError,
  sslOptionsForMode,
} from '@chm/postgres-client'

describe('assertReadOnlyStatement — SELECT-only gate', () => {
  test('allows single read-only statements', () => {
    for (const sql of [
      'SELECT 1',
      '  select version()  ',
      'WITH t AS (SELECT 1) SELECT * FROM t',
      'SHOW server_version',
      'EXPLAIN SELECT * FROM pg_stat_statements',
      'TABLE pg_stat_activity',
      'VALUES (1), (2)',
      'SELECT 1;', // a single trailing semicolon is tolerated
    ]) {
      expect(() => assertReadOnlyStatement(sql)).not.toThrow()
    }
  })

  test('rejects writes / DDL', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET x = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'CREATE TABLE t (id int)',
      'TRUNCATE t',
      'GRANT SELECT ON t TO u',
    ]) {
      expect(() => assertReadOnlyStatement(sql)).toThrow()
    }
  })

  test('rejects multi-statement injection', () => {
    expect(() => assertReadOnlyStatement('SELECT 1; DROP TABLE t')).toThrow(
      /single/i
    )
    expect(() => assertReadOnlyStatement('SELECT 1; SELECT 2')).toThrow(
      /single/i
    )
  })

  test('rejects empty input', () => {
    expect(() => assertReadOnlyStatement('   ')).toThrow()
  })
})

describe('sslOptionsForMode — libpq sslmode → pg ssl', () => {
  test('disable → no TLS', () => {
    expect(sslOptionsForMode('disable')).toBe(false)
  })

  test('require (and default) → TLS without cert verification', () => {
    expect(sslOptionsForMode('require')).toEqual({ rejectUnauthorized: false })
    expect(sslOptionsForMode(undefined)).toEqual({ rejectUnauthorized: false })
    expect(sslOptionsForMode('prefer')).toEqual({ rejectUnauthorized: false })
  })

  test('verify-ca / verify-full → TLS with cert verification', () => {
    expect(sslOptionsForMode('verify-ca')).toEqual({ rejectUnauthorized: true })
    expect(sslOptionsForMode('verify-full')).toEqual({
      rejectUnauthorized: true,
    })
  })

  test('is case-insensitive', () => {
    expect(sslOptionsForMode('DISABLE')).toBe(false)
    expect(sslOptionsForMode('Verify-Full')).toEqual({
      rejectUnauthorized: true,
    })
  })
})

describe('formatPostgresError — SQLSTATE-appended message', () => {
  test('appends a SQLSTATE code when present', () => {
    const err = Object.assign(
      new Error('password authentication failed for user "x"'),
      { code: '28P01' }
    )
    expect(formatPostgresError(err)).toContain('[28P01]')
  })

  test('passes through a Node network code', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    })
    expect(formatPostgresError(err)).toContain('[ECONNREFUSED]')
  })

  test('falls back for non-error inputs', () => {
    expect(formatPostgresError(null)).toBe('Postgres connection failed')
    expect(formatPostgresError({})).toBe('Postgres connection failed')
  })
})
