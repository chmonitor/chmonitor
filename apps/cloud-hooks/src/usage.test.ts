/**
 * Usage metrics — window arithmetic, graceful degradation, and the digest block.
 */

import type { D1UsageDb } from './usage'

import {
  collectUsage,
  formatActiveLine,
  shiftDay,
  stickiness,
  usageLines,
  utcDay,
} from './usage'
import { describe, expect, test } from 'bun:test'

/** 2026-07-24T06:00:00Z — a mid-morning run, so "yesterday" is 2026-07-23. */
const NOW = Math.floor(Date.parse('2026-07-24T06:00:00Z') / 1000)

interface Call {
  sql: string
  binds: unknown[]
}

/**
 * Fake D1 that dispatches on a substring of the SQL, so a test states only the
 * rows it cares about and the assertions read against real query text.
 */
function fakeDb(
  rows: Array<[match: string, row: unknown]>,
  calls: Call[] = []
): D1UsageDb & { calls: Call[] } {
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async first<T>() {
              calls.push({ sql, binds })
              const hit = rows.find(([match]) => sql.includes(match))
              return (hit ? hit[1] : null) as T | null
            },
          }
        },
      }
    },
  }
}

describe('day arithmetic', () => {
  test('utcDay formats a Date as the telemetry day key', () => {
    expect(utcDay(new Date('2026-07-23T23:59:59Z'))).toBe('2026-07-23')
  })

  test('shiftDay walks backwards across a month boundary', () => {
    expect(shiftDay('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('a 7-day window is the reference day minus 6, inclusive', () => {
    // Reference day INCLUDED in the window, so -6 gives 7 distinct days.
    expect(shiftDay('2026-07-23', -6)).toBe('2026-07-17')
    expect(shiftDay('2026-07-23', -29)).toBe('2026-06-24')
  })
})

describe('stickiness', () => {
  test('is DAU/MAU as a percentage with one decimal', () => {
    expect(stickiness({ dau: 25, wau: 60, mau: 100 })).toBe(25)
    expect(stickiness({ dau: 1, wau: 2, mau: 3 })).toBe(33.3)
  })

  test('is null (not 0%) when there is no monthly base to divide by', () => {
    expect(stickiness({ dau: 0, wau: 0, mau: 0 })).toBeNull()
  })
})

describe('collectUsage', () => {
  test('measures every window back from YESTERDAY, not today', async () => {
    const db = fakeDb([
      ['ping_daily', { dau: 10, wau: 40, mau: 120 }],
      ['cli_daily', { dau: 3, wau: 9, mau: 20 }],
    ])
    const usage = await collectUsage(db, NOW)

    // The run is on the 24th; the last COMPLETE UTC day is the 23rd.
    expect(usage?.referenceDay).toBe('2026-07-23')
    const windowCall = db.calls.find((c) => c.sql.includes('ping_daily'))
    expect(windowCall?.binds).toEqual([
      '2026-07-23', // ?1 reference day
      '2026-07-17', // ?2 week start
      '2026-06-24', // ?3 month start
    ])
  })

  test('reads dashboard and CLI streams into separate counts', async () => {
    const db = fakeDb([
      ['ping_daily', { dau: 10, wau: 40, mau: 120 }],
      ["event = 'cli_install'", { n: 7 }],
      ['cli_daily', { dau: 3, wau: 9, mau: 20 }],
    ])
    const usage = await collectUsage(db, NOW)

    expect(usage?.dashboard).toEqual({ dau: 10, wau: 40, mau: 120 })
    expect(usage?.cli).toEqual({ dau: 3, wau: 9, mau: 20 })
    expect(usage?.cliInstalls24h).toBe(7)
  })

  test('excludes install-only rows from the CLI active count', async () => {
    // cli_install rows can carry an ephemeral id, which would inflate DAU.
    const db = fakeDb([['cli_daily', { dau: 3, wau: 9, mau: 20 }]])
    await collectUsage(db, NOW)

    const cliWindowCall = db.calls.find(
      (c) => c.sql.includes('cli_daily') && c.sql.includes('COUNT(DISTINCT')
    )
    expect(cliWindowCall?.sql).toContain("event <> 'cli_install'")
  })

  test('returns null when the telemetry database is unbound', async () => {
    expect(await collectUsage(null, NOW)).toBeNull()
    expect(await collectUsage(undefined, NOW)).toBeNull()
  })

  test('returns null and logs when every query throws (never crashes the cron)', async () => {
    const boom: D1UsageDb = {
      prepare() {
        return {
          bind() {
            return {
              first<T>(): Promise<T | null> {
                throw new Error('no such table: ping_daily')
              },
            }
          },
        }
      },
    }
    const logged: string[] = []
    expect(await collectUsage(boom, NOW, (m) => logged.push(m))).toBeNull()
    // One line per failing stream — a silent null would hide a broken binding.
    expect(logged.length).toBeGreaterThan(0)
  })

  test('still reports the stream that works when the other table is missing', async () => {
    // cli_daily arrived in migration 0005; a database mid-migration must not
    // take down the whole Usage section.
    const partial: D1UsageDb = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first<T>(): Promise<T | null> {
                if (sql.includes('cli_daily')) {
                  throw new Error('no such table: cli_daily')
                }
                return { dau: 10, wau: 40, mau: 120 } as T
              },
            }
          },
        }
      },
    }
    const usage = await collectUsage(partial, NOW, () => {})
    expect(usage?.dashboard).toEqual({ dau: 10, wau: 40, mau: 120 })
    expect(usage?.cli).toEqual({ dau: 0, wau: 0, mau: 0 })
  })

  test('treats missing rows as zero rather than failing', async () => {
    const usage = await collectUsage(fakeDb([]), NOW)
    expect(usage).toBeNull() // both streams absent → nothing to report
  })
})

describe('digest block', () => {
  test('labels the numbers as installs, with the measured day', () => {
    const lines = usageLines({
      referenceDay: '2026-07-23',
      dashboard: { dau: 10, wau: 40, mau: 120 },
      cli: { dau: 3, wau: 9, mau: 20 },
      cliInstalls24h: 0,
    })
    const text = lines.join('\n')
    // "installs" is not cosmetic: telemetry has no user identity, so calling
    // these users would misreport the metric.
    expect(text).toContain('installs, 2026-07-23')
    expect(text).toContain('DAU 10 · WAU 40 · MAU 120')
    expect(text).not.toContain('New CLI installs') // omitted at 0
  })

  test('is empty when usage is unavailable so the caller can spread it', () => {
    expect(usageLines(null)).toEqual([])
  })

  test('omits stickiness when there is no monthly base', () => {
    expect(formatActiveLine('CLI', { dau: 0, wau: 0, mau: 0 })).not.toContain(
      'stickiness'
    )
  })
})
