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

const {
  EPISODE_VALUES_SQL,
  FIRST_SEEN_IN_EPISODE_SQL,
  findingRefLikePattern,
  queryEpisodeValues,
} = await import('./alert-history-store')

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

type ValueRow = [string, number, string, string, number | null]

function valuesDb(rows: ValueRow[]): Database {
  const d = db([])
  rows.forEach(([time, host, rule, severity, value], i) => {
    d.query(
      `INSERT INTO alert_events (id, event_time, host_id, rule, severity, decision_kind, delivered, value)
       VALUES (?1, ?2, ?3, ?4, ?5, 'new', 1, ?6)`
    ).run(`v${i}`, time, host, rule, severity, value)
  })
  return d
}

describe('EPISODE_VALUES_SQL', () => {
  test('the newest rows of the current episode, with the whole episode first value, severity and peak', () => {
    const d = valuesDb([
      ['2026-01-01T00:00:00Z', 1, 'disk-usage', 'warning', 50],
      ['2026-01-01T02:00:00Z', 1, 'disk-usage', 'recovery', 10],
      ['2026-01-02T00:00:00Z', 1, 'disk-usage', 'warning', 85],
      ['2026-01-02T01:00:00Z', 1, 'disk-usage', 'critical', 99],
      ['2026-01-02T02:00:00Z', 1, 'disk-usage', 'critical', 92],
      ['2026-01-02T03:00:00Z', 1, 'disk-usage', 'critical', 91],
      ['2026-01-02T04:00:00Z', 2, 'disk-usage', 'critical', 100],
      ['2026-01-02T05:00:00Z', 1, 'other-rule', 'critical', 100],
      ['2026-01-02T06:00:00Z', 1, 'disk-usage', 'critical', null],
      // The recovery this dispatch is announcing, written before the read.
      [NOW, 1, 'disk-usage', 'recovery', 5],
    ])
    expect(d.query(EPISODE_VALUES_SQL).all(1, 'disk-usage', NOW, 2)).toEqual([
      {
        value: 91,
        first_seen: '2026-01-02T00:00:00Z',
        first_value: 85,
        first_severity: 'warning',
        peak: 99,
      },
      {
        value: 92,
        first_seen: '2026-01-02T00:00:00Z',
        first_value: 85,
        first_severity: 'warning',
        peak: 99,
      },
    ])
  })
})

describe('queryEpisodeValues', () => {
  function d1(d: Database) {
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({
            results: d.query(sql).all(...(args as (string | number)[])),
            success: true,
            meta: {},
          }),
        }),
      }),
    }
  }

  test('folds the rows several channels wrote for one notification', async () => {
    const d = valuesDb([
      ['2026-01-02T00:00:00.000Z', 1, 'disk-usage', 'warning', 85],
      ['2026-01-02T00:00:00.004Z', 1, 'disk-usage', 'warning', 85],
      ['2026-01-02T01:00:00.000Z', 1, 'disk-usage', 'critical', 97],
      ['2026-01-02T01:00:00.003Z', 1, 'disk-usage', 'critical', 97],
      ['2026-01-02T02:00:00.000Z', 1, 'disk-usage', 'critical', 92],
    ])
    installHealthPlatformMock(() => d1(d))
    try {
      expect(await queryEpisodeValues(1, 'disk-usage', NOW)).toEqual({
        series: [85, 97, 92],
        firstSeenAt: '2026-01-02T00:00:00.000Z',
        firstValue: 85,
        firstSeverity: 'warning',
        peak: 97,
      })
      expect(await queryEpisodeValues(2, 'disk-usage', NOW)).toBeNull()
    } finally {
      installHealthPlatformMock(() => undefined)
    }
  })
})
