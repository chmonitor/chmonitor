/**
 * Tests for quiet hours (#2662).
 *
 * Three layers, mirroring maintenance-windows.test.ts:
 *  1. Pure matchers (`isWithinQuietWindow` / `isQuietSuppressed` / timezone +
 *     across-midnight handling + severityCap) — the logic the sweep's dispatch
 *     gate depends on, unit-tested directly (no D1).
 *  2. The catch-up tracker (`markQuietSuppression` / `takeDueCatchUp`) — the
 *     bookkeeping that lets a suppressed critical get a labeled catch-up once
 *     its window closes.
 *  3. The D1-backed store (`listQuietHours`/`createQuietHours`/`deleteQuietHours`)
 *     via a behavioral D1 fake, exercising the real SQL, owner scoping,
 *     validation, and fail-open degrade.
 */

import type { QuietHours } from './quiet-hours'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// --- behavioral D1 fake ------------------------------------------------------
interface FakeRow {
  id: string
  owner_id: string
  days: string
  start_time: string
  end_time: string
  timezone: string
  severity_cap: string | null
  created_by: string
  created_at: number
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const isDelete = /^\s*DELETE FROM/i.test(sql)
    const isSelect = /^\s*SELECT/i.test(sql)

    return {
      bind(...args: unknown[]) {
        return {
          async run(): Promise<{ meta: { changes: number } }> {
            if (isInsert) {
              const [
                id,
                ownerId,
                days,
                startTime,
                endTime,
                timezone,
                severityCap,
                createdBy,
                createdAt,
              ] = args as [
                string,
                string,
                string,
                string,
                string,
                string,
                string | null,
                string,
                number,
              ]
              rows.push({
                id,
                owner_id: ownerId,
                days,
                start_time: startTime,
                end_time: endTime,
                timezone,
                severity_cap: severityCap,
                created_by: createdBy,
                created_at: createdAt,
              })
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const [id, ownerId] = args as [string, string]
              const idx = rows.findIndex(
                (r) => r.id === id && r.owner_id === ownerId
              )
              if (idx >= 0) rows.splice(idx, 1)
              return { meta: { changes: idx >= 0 ? 1 : 0 } }
            }
            throw new Error(`fake D1: run() called on unexpected SQL: ${sql}`)
          },
          async all<T>(): Promise<{ results: T[] }> {
            if (!isSelect)
              throw new Error(`fake D1: all() called on non-SELECT: ${sql}`)
            const [ownerId] = args as [string]
            const filtered = rows
              .filter((r) => r.owner_id === ownerId)
              .sort((a, b) => b.created_at - a.created_at)
            return { results: filtered as unknown as T[] }
          },
        }
      },
    }
  }

  return {
    rows,
    prepare,
    batch: async (stmts: unknown[]) =>
      stmts.map(() => ({ meta: { changes: 0 } })),
  }
}

let fakeDb: ReturnType<typeof makeFakeD1> | null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => fakeDb,
  }),
}))

const {
  isWithinQuietWindow,
  activeQuietWindow,
  isQuietSuppressed,
  quietWindowEndMs,
  parseHmToMinutes,
  markQuietSuppression,
  takeDueCatchUp,
  clearQuietSuppression,
  _resetQuietCatchUpTracker,
  listQuietHours,
  createQuietHours,
  deleteQuietHours,
} = await import('./quiet-hours')

function qh(over: Partial<QuietHours> = {}): QuietHours {
  return {
    id: 'q1',
    ownerId: 'owner-a',
    days: [1, 2, 3, 4, 5],
    start: '22:00',
    end: '07:00',
    timezone: 'UTC',
    severityCap: 'critical',
    createdBy: 'user_1',
    createdAt: 500,
    ...over,
  }
}

// A fixed instant: Monday 2026-01-05 23:30 UTC (Jan 1 2026 is a Thursday).
const MON_2330_UTC = Date.UTC(2026, 0, 5, 23, 30)
const TUE_0630_UTC = Date.UTC(2026, 0, 6, 6, 30)
const TUE_0700_UTC = Date.UTC(2026, 0, 6, 7, 0)
const TUE_0800_UTC = Date.UTC(2026, 0, 6, 8, 0)
const MON_2100_UTC = Date.UTC(2026, 0, 5, 21, 0)
const MON_1400_UTC = Date.UTC(2026, 0, 5, 14, 0)

// ---------------------------------------------------------------------------
// parseHmToMinutes
// ---------------------------------------------------------------------------
describe('parseHmToMinutes', () => {
  test('parses valid HH:mm', () => {
    expect(parseHmToMinutes('00:00')).toBe(0)
    expect(parseHmToMinutes('07:30')).toBe(450)
    expect(parseHmToMinutes('23:59')).toBe(1439)
  })
  test('rejects malformed / out-of-range', () => {
    expect(parseHmToMinutes('24:00')).toBeNull()
    expect(parseHmToMinutes('7:60')).toBeNull()
    expect(parseHmToMinutes('nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isWithinQuietWindow — across midnight + day boundaries (UTC)
// ---------------------------------------------------------------------------
describe('isWithinQuietWindow (across midnight)', () => {
  const w = qh({ days: [1], start: '22:00', end: '07:00', timezone: 'UTC' })

  test('true in the evening portion on the start weekday', () => {
    expect(isWithinQuietWindow(w, MON_2330_UTC)).toBe(true)
  })
  test('true in the morning portion (belongs to the start weekday)', () => {
    expect(isWithinQuietWindow(w, TUE_0630_UTC)).toBe(true)
  })
  test('false after the window ends', () => {
    expect(isWithinQuietWindow(w, TUE_0800_UTC)).toBe(false)
  })
  test('false before the window starts', () => {
    expect(isWithinQuietWindow(w, MON_2100_UTC)).toBe(false)
  })
  test('false when the weekday is not selected', () => {
    // Tuesday-only window does NOT cover Monday evening.
    const tueOnly = qh({ days: [2], start: '22:00', end: '07:00' })
    expect(isWithinQuietWindow(tueOnly, MON_2330_UTC)).toBe(false)
  })
})

describe('isWithinQuietWindow (same day)', () => {
  const w = qh({ days: [1], start: '09:00', end: '17:00' })

  test('start is inclusive, end is exclusive', () => {
    const mon0900 = Date.UTC(2026, 0, 5, 9, 0)
    const mon1700 = Date.UTC(2026, 0, 5, 17, 0)
    expect(isWithinQuietWindow(w, mon0900)).toBe(true)
    expect(isWithinQuietWindow(w, mon1700)).toBe(false)
  })
  test('equal start/end never matches', () => {
    expect(
      isWithinQuietWindow(qh({ start: '09:00', end: '09:00' }), MON_1400_UTC)
    ).toBe(false)
  })
  test('empty days never matches', () => {
    expect(isWithinQuietWindow(qh({ days: [] }), MON_2330_UTC)).toBe(false)
  })
})

describe('isWithinQuietWindow (timezone)', () => {
  // Same instant, different zones → different local wall-clock.
  const w = (tz: string) =>
    qh({ days: [1], start: '09:00', end: '17:00', timezone: tz })

  test('the same UTC instant matches or not depending on the window timezone', () => {
    // Mon 14:00 UTC.
    expect(isWithinQuietWindow(w('UTC'), MON_1400_UTC)).toBe(true) // 14:00 local
    expect(isWithinQuietWindow(w('America/New_York'), MON_1400_UTC)).toBe(true) // 09:00 local
    expect(isWithinQuietWindow(w('Asia/Tokyo'), MON_1400_UTC)).toBe(false) // 23:00 local
  })

  test('invalid timezone fails open (not in window)', () => {
    expect(isWithinQuietWindow(w('Not/AZone'), MON_1400_UTC)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// activeQuietWindow + isQuietSuppressed — severityCap
// ---------------------------------------------------------------------------
describe('isQuietSuppressed (severityCap)', () => {
  test('cap=null suppresses every severity while active', () => {
    const windows = [qh({ days: [1], severityCap: null })]
    expect(isQuietSuppressed(windows, 'warning', MON_2330_UTC)).toBe(true)
    expect(isQuietSuppressed(windows, 'critical', MON_2330_UTC)).toBe(true)
  })

  test('cap=critical suppresses warnings but lets criticals page', () => {
    const windows = [qh({ days: [1], severityCap: 'critical' })]
    expect(isQuietSuppressed(windows, 'warning', MON_2330_UTC)).toBe(true)
    expect(isQuietSuppressed(windows, 'critical', MON_2330_UTC)).toBe(false)
  })

  test('nothing suppressed when no window is active', () => {
    const windows = [qh({ days: [1], severityCap: null })]
    expect(isQuietSuppressed(windows, 'critical', TUE_0800_UTC)).toBe(false)
    expect(isQuietSuppressed([], 'warning', MON_2330_UTC)).toBe(false)
  })

  test('activeQuietWindow returns the covering window or null', () => {
    const windows = [qh({ days: [1] })]
    expect(activeQuietWindow(windows, MON_2330_UTC)?.id).toBe('q1')
    expect(activeQuietWindow(windows, TUE_0800_UTC)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// quietWindowEndMs
// ---------------------------------------------------------------------------
describe('quietWindowEndMs', () => {
  test('across-midnight evening portion ends at the next morning end time', () => {
    const w = qh({ days: [1], start: '22:00', end: '07:00', timezone: 'UTC' })
    // Mon 23:30 UTC → end is Tue 07:00 UTC.
    expect(quietWindowEndMs(w, MON_2330_UTC)).toBe(TUE_0700_UTC)
  })
  test('across-midnight morning portion ends later today', () => {
    const w = qh({ days: [1], start: '22:00', end: '07:00', timezone: 'UTC' })
    // Tue 06:30 UTC → end is Tue 07:00 UTC.
    expect(quietWindowEndMs(w, TUE_0630_UTC)).toBe(TUE_0700_UTC)
  })
})

// ---------------------------------------------------------------------------
// catch-up tracker
// ---------------------------------------------------------------------------
describe('catch-up tracker', () => {
  beforeEach(() => _resetQuietCatchUpTracker())

  test('takeDueCatchUp is false while the window is still open, true once ended', () => {
    markQuietSuppression(3, 'disk', 'critical', 2000)
    expect(takeDueCatchUp(3, 'disk', 1500)).toBe(false) // before end
    expect(takeDueCatchUp(3, 'disk', 2000)).toBe(true) // at end → due
  })

  test('a due catch-up is consumed exactly once', () => {
    markQuietSuppression(3, 'disk', 'critical', 2000)
    expect(takeDueCatchUp(3, 'disk', 2500)).toBe(true)
    expect(takeDueCatchUp(3, 'disk', 2500)).toBe(false)
  })

  test('no marker → no catch-up', () => {
    expect(takeDueCatchUp(9, 'nope', 9999)).toBe(false)
  })

  test('clearQuietSuppression drops a pending marker (e.g. recovery)', () => {
    markQuietSuppression(3, 'disk', 'critical', 2000)
    clearQuietSuppression(3, 'disk')
    expect(takeDueCatchUp(3, 'disk', 2500)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D1-backed store
// ---------------------------------------------------------------------------
describe('quiet-hours d1 store', () => {
  beforeEach(() => {
    fakeDb = makeFakeD1()
  })

  test('create then list round-trips every field', async () => {
    const created = await createQuietHours({
      ownerId: 'owner-roundtrip',
      days: [5, 1, 1, 3], // dupes + unsorted → normalized
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
      severityCap: 'critical',
      createdBy: 'user_1',
    })

    expect(created.days).toEqual([1, 3, 5])
    const listed = await listQuietHours('owner-roundtrip')
    expect(listed).toEqual([created])
  })

  test('createQuietHours rejects empty days', async () => {
    await expect(
      createQuietHours({
        ownerId: 'owner-invalid-days',
        days: [],
        start: '22:00',
        end: '07:00',
        timezone: 'UTC',
        severityCap: null,
        createdBy: 'u',
      })
    ).rejects.toThrow()
  })

  test('createQuietHours rejects equal start/end and bad timezone', async () => {
    await expect(
      createQuietHours({
        ownerId: 'owner-equal',
        days: [1],
        start: '09:00',
        end: '09:00',
        timezone: 'UTC',
        severityCap: null,
        createdBy: 'u',
      })
    ).rejects.toThrow()
    await expect(
      createQuietHours({
        ownerId: 'owner-badtz',
        days: [1],
        start: '09:00',
        end: '17:00',
        timezone: 'Not/AZone',
        severityCap: null,
        createdBy: 'u',
      })
    ).rejects.toThrow()
  })

  test('listQuietHours only returns rows for the requested owner', async () => {
    await createQuietHours({
      ownerId: 'owner-scope-a',
      days: [1],
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
      severityCap: null,
      createdBy: 'u',
    })
    await createQuietHours({
      ownerId: 'owner-scope-b',
      days: [2],
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
      severityCap: null,
      createdBy: 'u',
    })
    expect((await listQuietHours('owner-scope-a')).map((w) => w.days)).toEqual([
      [1],
    ])
    expect((await listQuietHours('owner-scope-b')).map((w) => w.days)).toEqual([
      [2],
    ])
  })

  test("deleteQuietHours is owner-scoped: cannot delete another owner's window", async () => {
    const created = await createQuietHours({
      ownerId: 'owner-del-a',
      days: [1],
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
      severityCap: null,
      createdBy: 'u',
    })
    await deleteQuietHours('owner-del-b', created.id)
    expect((await listQuietHours('owner-del-a')).map((w) => w.id)).toEqual([
      created.id,
    ])
    await deleteQuietHours('owner-del-a', created.id)
    expect(await listQuietHours('owner-del-a')).toEqual([])
  })

  test('degrades to [] / throws-on-create when no D1 binding is present', async () => {
    fakeDb = null
    expect(await listQuietHours('owner-no-binding')).toEqual([])
    await expect(
      createQuietHours({
        ownerId: 'owner-no-binding',
        days: [1],
        start: '22:00',
        end: '07:00',
        timezone: 'UTC',
        severityCap: null,
        createdBy: 'u',
      })
    ).rejects.toThrow()
    await expect(
      deleteQuietHours('owner-no-binding', 'missing')
    ).resolves.toBeUndefined()
  })
})
