/**
 * Unit tests for the advisor query-history picker's pure SQL/param builders and
 * text helpers (`lib/ai/advisor/history-picker.ts`). No I/O — these guard the
 * injection-safe parameterization, kind=all, and the default self-query exclude.
 */

import { describe, expect, test } from 'bun:test'
import {
  buildHistoryPickerQuery,
  buildHistoryUsersQuery,
  HISTORY_PICKER_DEFAULT_HOURS,
  HISTORY_PICKER_KIND_ALL,
  HISTORY_PICKER_MAX_LIMIT,
  truncateQueryText,
} from '@/lib/ai/advisor/history-picker'

describe('buildHistoryPickerQuery', () => {
  test('defaults to finished queries of any kind within the default window', () => {
    const { sql, params } = buildHistoryPickerQuery()
    expect(sql).toContain("type = 'QueryFinish'")
    expect(sql).toContain(`INTERVAL ${HISTORY_PICKER_DEFAULT_HOURS} HOUR`)
    expect(sql).not.toContain('query_kind = {kind:String}')
    expect(params.kind).toBeUndefined()
    expect(sql).toContain('ORDER BY query_duration_ms DESC')
    expect(sql).toContain(`LIMIT ${HISTORY_PICKER_MAX_LIMIT}`)
  })

  test('All kinds omits the query_kind predicate', () => {
    const { sql, params } = buildHistoryPickerQuery({
      kind: HISTORY_PICKER_KIND_ALL,
    })
    expect(sql).not.toContain('query_kind')
    expect(params.kind).toBeUndefined()
  })

  test('unset kind does not fall back to Select', () => {
    const { sql, params } = buildHistoryPickerQuery({})
    expect(sql).not.toContain('query_kind = {kind:String}')
    expect(params.kind).toBeUndefined()
  })

  test('honors a valid non-Select kind', () => {
    const { sql, params } = buildHistoryPickerQuery({ kind: 'Insert' })
    expect(params.kind).toBe('Insert')
    expect(sql).toContain('query_kind = {kind:String}')
  })

  test('ignores an unknown kind instead of forcing Select', () => {
    const { sql, params } = buildHistoryPickerQuery({
      // @ts-expect-error deliberately invalid kind
      kind: 'Nonsense',
    })
    expect(params.kind).toBeUndefined()
    expect(sql).not.toContain('query_kind')
  })

  test('default excludes dashboard queries via the query-comment fingerprint', () => {
    const { sql, params } = buildHistoryPickerQuery()
    expect(params.selfFingerprint).toBeDefined()
    expect(params.selfFingerprint?.length).toBeGreaterThan(0)
    expect(sql).toContain('position(query, {selfFingerprint:String}) = 0')
    expect(sql).not.toContain(params.selfFingerprint as string)
  })

  test('excludeSelf:false (include-self) omits the dashboard fingerprint', () => {
    const { sql, params } = buildHistoryPickerQuery({ excludeSelf: false })
    expect(params.selfFingerprint).toBeUndefined()
    expect(sql).not.toContain('selfFingerprint')
  })

  test('binds keyword as a parameter (never interpolated)', () => {
    const evil = "'; DROP TABLE system.query_log; --"
    const { sql, params } = buildHistoryPickerQuery({ keyword: evil })
    expect(params.keyword).toBe(evil)
    expect(sql).toContain(
      'positionCaseInsensitiveUTF8(query, {keyword:String}) > 0'
    )
    expect(sql).not.toContain('DROP TABLE')
  })

  test('binds user as a parameter', () => {
    const { sql, params } = buildHistoryPickerQuery({ user: "o'brien" })
    expect(params.user).toBe("o'brien")
    expect(sql).toContain('user = {user:String}')
  })

  test('omits keyword/user clauses when blank', () => {
    const { sql, params } = buildHistoryPickerQuery({ keyword: '  ', user: '' })
    expect(sql).not.toContain('{keyword:String}')
    expect(sql).not.toContain('user = {user:String}')
    expect(params.keyword).toBeUndefined()
    expect(params.user).toBeUndefined()
  })

  test('clamps limit to the max and floors invalid hours', () => {
    const { sql } = buildHistoryPickerQuery({ limit: 9999, hours: 3.9 })
    expect(sql).toContain(`LIMIT ${HISTORY_PICKER_MAX_LIMIT}`)
    expect(sql).toContain('INTERVAL 3 HOUR')
  })

  test('inlines min duration only when positive', () => {
    expect(buildHistoryPickerQuery({ minDurationMs: 1500 }).sql).toContain(
      'query_duration_ms >= 1500'
    )
    expect(buildHistoryPickerQuery({ minDurationMs: 0 }).sql).not.toContain(
      'query_duration_ms >='
    )
  })
})

describe('buildHistoryUsersQuery', () => {
  test('selects distinct non-empty users within the window', () => {
    const { sql, params } = buildHistoryUsersQuery(6)
    expect(sql).toContain('SELECT DISTINCT user')
    expect(sql).toContain('INTERVAL 6 HOUR')
    expect(sql).toContain("user != ''")
    expect(Object.keys(params)).toHaveLength(0)
  })
})

describe('truncateQueryText', () => {
  test('collapses whitespace', () => {
    expect(truncateQueryText('SELECT\n  1,\t2')).toBe('SELECT 1, 2')
  })

  test('clips and appends an ellipsis past the limit', () => {
    const out = truncateQueryText('a'.repeat(200), 10)
    expect(out).toHaveLength(11) // 10 chars + ellipsis
    expect(out.endsWith('…')).toBe(true)
  })

  test('leaves short text untouched', () => {
    expect(truncateQueryText('SELECT 1', 100)).toBe('SELECT 1')
  })
})
