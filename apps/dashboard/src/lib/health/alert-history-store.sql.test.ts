/**
 * `firstSeenAt` (#3998) is the first sighting of the CURRENT episode, read
 * from alert history. Runs the exact exported SQL against real SQLite (D1's
 * engine) so the episode boundary and digest matching are executed, not
 * re-derived. A wrong boundary would report a previous episode's start and
 * overstate how long the condition has held.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

installHealthPlatformMock()

const { FIRST_SEEN_IN_EPISODE_SQL, findingRefLikePattern } = await import(
  './alert-history-store'
)

function db(rows: [string, number, string, string, string | null][]): Database {
  const d = new Database(':memory:')
  d.run(`CREATE TABLE alert_events (
    id TEXT PRIMARY KEY, event_time TEXT NOT NULL, host_id INTEGER NOT NULL,
    host_label TEXT, rule TEXT NOT NULL, severity TEXT NOT NULL,
    prev_severity TEXT, decision_kind TEXT NOT NULL, delivered INTEGER NOT NULL,
    error TEXT, value REAL, channel TEXT, finding_refs TEXT)`)
  rows.forEach(([time, host, rule, severity, refs], i) => {
    d.query(
      `INSERT INTO alert_events (id, event_time, host_id, rule, severity, decision_kind, delivered, finding_refs)
       VALUES (?1, ?2, ?3, ?4, ?5, 'new', 1, ?6)`
    ).run(`r${i}`, time, host, rule, severity, refs)
  })
  return d
}

const NOW = '2027-01-01T00:00:00Z'

function firstSeen(
  d: Database,
  host: number,
  rule: string,
  before = NOW
): string | null {
  const row = d
    .query(FIRST_SEEN_IN_EPISODE_SQL)
    .get(host, rule, findingRefLikePattern(host, rule), before) as {
    first_seen: string | null
  }
  return row.first_seen
}

describe('FIRST_SEEN_IN_EPISODE_SQL', () => {
  test('starts after the latest recovery, not at the previous episode', () => {
    const d = db([
      ['2026-01-01T00:00:00Z', 1, 'disk-usage', 'warning', null],
      ['2026-01-01T02:00:00Z', 1, 'disk-usage', 'recovery', null],
      ['2026-01-02T00:00:00Z', 1, 'disk-usage', 'warning', null],
      ['2026-01-02T05:00:00Z', 1, 'disk-usage', 'critical', null],
    ])
    expect(firstSeen(d, 1, 'disk-usage')).toBe('2026-01-02T00:00:00Z')
  })

  test('with no recovery, the earliest row of the pair', () => {
    const d = db([
      ['2026-01-03T00:00:00Z', 1, 'disk-usage', 'warning', null],
      ['2026-01-01T00:00:00Z', 1, 'disk-usage', 'warning', null],
      ['2025-12-01T00:00:00Z', 2, 'disk-usage', 'warning', null],
      ['2025-12-01T00:00:00Z', 1, 'parts-pressure', 'warning', null],
    ])
    expect(firstSeen(d, 1, 'disk-usage')).toBe('2026-01-01T00:00:00Z')
  })

  test('a digest row referencing the finding counts as a sighting', () => {
    const d = db([
      [
        '2026-01-01T00:00:00Z',
        9,
        'digest',
        'warning',
        '["9:x","1:disk-usage"]',
      ],
      ['2026-01-02T00:00:00Z', 1, 'disk-usage', 'warning', null],
      ['2025-01-01T00:00:00Z', 9, 'digest', 'warning', '["1:disk_usage"]'],
      // `_` in a rule id must not act as a LIKE wildcard.
      ['2024-01-01T00:00:00Z', 9, 'digest', 'warning', '["1:diskXusage"]'],
    ])
    expect(firstSeen(d, 1, 'disk-usage')).toBe('2026-01-01T00:00:00Z')
    expect(firstSeen(d, 1, 'disk_usage')).toBe('2025-01-01T00:00:00Z')
  })

  // The block may resolve after this dispatch already wrote its own rows.
  test("this dispatch's own rows never count, whatever lands first", () => {
    const d = db([
      ['2026-01-01T00:00:00Z', 1, 'disk-usage', 'warning', null],
      // The recovery this dispatch is announcing, written before the read.
      [NOW, 1, 'disk-usage', 'recovery', null],
    ])
    expect(firstSeen(d, 1, 'disk-usage')).toBe('2026-01-01T00:00:00Z')
    // A brand-new episode's own row is not its first sighting from history.
    const fresh = db([[NOW, 1, 'disk-usage', 'warning', null]])
    expect(firstSeen(fresh, 1, 'disk-usage')).toBeNull()
  })

  test('only a recovery, or nothing, is null', () => {
    expect(firstSeen(db([]), 1, 'disk-usage')).toBeNull()
    const d = db([['2026-01-01T00:00:00Z', 1, 'disk-usage', 'recovery', null]])
    expect(firstSeen(d, 1, 'disk-usage')).toBeNull()
  })
})
