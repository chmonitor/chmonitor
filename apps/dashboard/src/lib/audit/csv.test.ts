/**
 * Pure unit tests for the audit export CSV builder — no D1/network
 * dependency, so no mocking is required here.
 */

import type { AuditLogRow } from './query'

import { AUDIT_CSV_HEADER, buildAuditCsv } from './csv'
import { describe, expect, test } from 'bun:test'

function row(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    event_time: '2026-01-01T00:00:00.000Z',
    user_id: 'user_1',
    event: 'member.invited',
    resource: 'user_2',
    action: 'invite',
    result: 'success',
    ip: '203.0.113.1',
    ...overrides,
  }
}

describe('buildAuditCsv — shape', () => {
  test('the header row matches the exact plan-specified column order', () => {
    expect(AUDIT_CSV_HEADER).toBe(
      'event_time,user_id,event,resource,action,result,ip'
    )
  })

  test('zero rows still produces a header-only CSV (not empty string)', () => {
    expect(buildAuditCsv([])).toBe(AUDIT_CSV_HEADER)
  })

  test('one row serializes as header + exactly one data line, in column order', () => {
    const csv = buildAuditCsv([row()])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(AUDIT_CSV_HEADER)
    expect(lines[1]).toBe(
      '2026-01-01T00:00:00.000Z,user_1,member.invited,user_2,invite,success,203.0.113.1'
    )
  })

  test('multiple rows preserve input order (caller/query controls sort)', () => {
    const csv = buildAuditCsv([
      row({ event: 'first' }),
      row({ event: 'second' }),
    ])
    const lines = csv.split('\n')
    expect(lines[1]).toContain('first')
    expect(lines[2]).toContain('second')
  })

  test('null fields (e.g. user_id, resource, ip) render as empty CSV cells', () => {
    const csv = buildAuditCsv([
      row({ user_id: null, resource: null, ip: null }),
    ])
    const dataLine = csv.split('\n')[1]
    expect(dataLine).toBe(
      '2026-01-01T00:00:00.000Z,,member.invited,,invite,success,'
    )
  })
})

describe('buildAuditCsv — comma/quote/newline escaping', () => {
  test('a field containing a comma is wrapped in quotes', () => {
    const csv = buildAuditCsv([row({ resource: 'a,b' })])
    expect(csv.split('\n')[1]).toContain('"a,b"')
  })

  test('a field containing a double quote is wrapped and the quote is doubled', () => {
    const csv = buildAuditCsv([row({ resource: 'say "hi"' })])
    expect(csv.split('\n')[1]).toContain('"say ""hi"""')
  })

  test('a field containing a newline is wrapped in quotes', () => {
    const csv = buildAuditCsv([row({ resource: 'line1\nline2' })])
    expect(csv.split('\n').length).toBeGreaterThan(2) // the embedded \n splits naively
    expect(csv).toContain('"line1\nline2"')
  })
})

describe('buildAuditCsv — CSV/formula injection defusing', () => {
  // OWASP CSV injection: a cell opened by Excel/Sheets that starts with
  // =, +, -, @, tab, or CR can execute as a formula. Every field the audit
  // log stores (resource, event, user_id, ip) can contain attacker-supplied
  // strings (e.g. a connection name), so this must hold for any column —
  // not just one hand-picked field.
  test.each([
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(1+1)', "'@SUM(1+1)"],
  ])('a value starting with %p is prefixed with a defusing quote', (input) => {
    const csv = buildAuditCsv([row({ resource: input })])
    const dataLine = csv.split('\n')[1] as string
    const resourceCell = dataLine.split(',')[3]
    expect(resourceCell?.startsWith("'")).toBe(true)
    expect(resourceCell).toBe(`'${input}`)
  })

  test('a safe value (no leading formula trigger) is left unprefixed', () => {
    const csv = buildAuditCsv([row({ resource: 'my-connection' })])
    expect(csv.split('\n')[1]).toContain(',my-connection,')
  })

  test('the server-generated event_time column is never defused (never starts with a trigger char)', () => {
    const csv = buildAuditCsv([row()])
    const dataLine = csv.split('\n')[1] as string
    expect(dataLine.startsWith("'")).toBe(false)
  })

  test('a defused value that also contains a comma is quoted AND defused together', () => {
    const csv = buildAuditCsv([row({ resource: '=A1,B1' })])
    const dataLine = csv.split('\n')[1] as string
    expect(dataLine).toContain('"\'=A1,B1"')
  })
})
