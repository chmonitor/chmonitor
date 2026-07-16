/**
 * Quiet hours — recurring time-of-day alert-delivery silence windows (#2662).
 *
 * The recurring sibling of `maintenance-windows.ts`: instead of a one-shot
 * absolute `[startsAt, endsAt)` range, a quiet-hours window recurs on chosen
 * weekdays for a wall-clock time range in an operator-chosen IANA timezone
 * ("don't page me 22:00–07:00 on weekdays"). While `now` falls inside a
 * matching window, `server-sweep.ts` skips the outbound notification for an
 * otherwise-notify-worthy finding — exactly like a maintenance window. The
 * rule still runs, the finding is still reported in the sweep summary and the
 * alert history (with a `quiet-hours` marker), and the dedup state store
 * (`alert-state-store.ts`) is left untouched (we never `commit()` a suppressed
 * decision), so the moment a window closes the next sweep re-evaluates fresh
 * and notifies normally — the natural catch-up.
 *
 * `severityCap` lets criticals still page during a window: `null` suppresses
 * everything; `'critical'` allows `>= critical` through and suppresses only
 * warnings.
 *
 * Storage mirrors `maintenance-windows.ts` verbatim (dedicated `MAINTENANCE_D1`
 * binding, then the shared `CHM_CLOUD_D1`; lazy single-flight migration; every
 * failure caught/logged/swallowed → "no windows" OSS default). The pure
 * matchers (`isWithinQuietWindow` / `activeQuietWindow` / `isQuietSuppressed`)
 * and the catch-up tracker are D1-free so they are fully unit-testable without
 * mocking D1.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'quiet-hours'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[quiet-hours] ${msg}`, { component: COMPONENT })

/** Preferred dedicated binding, then the shared cloud-mode D1 binding. */
const D1_BINDING_NAMES = ['MAINTENANCE_D1', 'CHM_CLOUD_D1'] as const

const TABLE = 'quiet_hours'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '[]',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    severity_cap TEXT,
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )
`
const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_quiet_hours_owner
    ON ${TABLE} (owner_id)
`

/** Only 'critical' is meaningful — the highest actionable severity. */
export type SeverityCap = 'critical'

/** Actionable severities the sweep may dispatch (never 'ok'). */
export type QuietSeverity = 'warning' | 'critical'

export interface QuietHours {
  id: string
  ownerId: string
  /** Weekday numbers, 0 = Sunday … 6 = Saturday (JS `Date#getDay`). */
  days: number[]
  /** Local wall-clock start, `'HH:mm'`. */
  start: string
  /** Local wall-clock end, `'HH:mm'`. May be < start (across midnight). */
  end: string
  /** IANA timezone the wall-clock times are interpreted in. */
  timezone: string
  /** null => suppress all; 'critical' => allow criticals through. */
  severityCap: SeverityCap | null
  createdBy: string
  /** unix ms */
  createdAt: number
}

export interface CreateQuietHoursInput {
  ownerId: string
  days: number[]
  start: string
  end: string
  timezone: string
  severityCap: SeverityCap | null
  createdBy: string
}

/** D1 row shape (snake_case columns). */
interface D1QuietRow {
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

function parseDays(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6
    )
  } catch {
    return []
  }
}

function rowToQuietHours(row: D1QuietRow): QuietHours {
  return {
    id: row.id,
    ownerId: row.owner_id,
    days: parseDays(row.days),
    start: row.start_time,
    end: row.end_time,
    timezone: row.timezone,
    severityCap: row.severity_cap === 'critical' ? 'critical' : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Pure matchers — no I/O, no D1 (unit-tested directly).
// ---------------------------------------------------------------------------

/** `'HH:mm'` → minutes-of-day (0..1439), or null when malformed. */
export function parseHmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Weekday (0=Sun..6=Sat) and minute-of-day for `now` in `timezone`, via
 * `Intl.DateTimeFormat` (handles DST and offsets correctly). Returns null when
 * the timezone is invalid so callers can fail-open ("not in window").
 */
export function zonedWeekdayMinutes(
  now: number,
  timezone: string
): { weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now))

    let weekday: number | undefined
    let hour = 0
    let minute = 0
    for (const p of parts) {
      if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value]
      else if (p.type === 'hour') hour = Number(p.value) % 24
      else if (p.type === 'minute') minute = Number(p.value)
    }
    if (weekday === undefined) return null
    return { weekday, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

/**
 * True iff `now` falls inside this recurring window. `days` are keyed to the
 * weekday the window STARTS on, so an across-midnight window (start > end) that
 * lists Monday covers Mon 22:00→23:59 and Tue 00:00→06:59.
 */
export function isWithinQuietWindow(window: QuietHours, now: number): boolean {
  const startMin = parseHmToMinutes(window.start)
  const endMin = parseHmToMinutes(window.end)
  if (startMin === null || endMin === null || startMin === endMin) return false
  if (window.days.length === 0) return false

  const zoned = zonedWeekdayMinutes(now, window.timezone)
  if (!zoned) return false
  const { weekday, minutes } = zoned
  const prevWeekday = (weekday + 6) % 7

  if (startMin < endMin) {
    // Same-day window.
    return (
      window.days.includes(weekday) && minutes >= startMin && minutes < endMin
    )
  }
  // Across-midnight window: the evening portion belongs to today's weekday,
  // the morning portion to yesterday's (the day the window started).
  const eveningPortion = window.days.includes(weekday) && minutes >= startMin
  const morningPortion = window.days.includes(prevWeekday) && minutes < endMin
  return eveningPortion || morningPortion
}

/** First window (in list order) that currently covers `now`, else null. */
export function activeQuietWindow(
  windows: QuietHours[],
  now: number
): QuietHours | null {
  return windows.find((w) => isWithinQuietWindow(w, now)) ?? null
}

/**
 * Whether delivery of a finding at `severity` should be silenced right now.
 * Suppressed when a window is active AND its `severityCap` doesn't let this
 * severity through: `null` suppresses everything; `'critical'` suppresses
 * anything below critical (i.e. warnings) and lets criticals page.
 */
export function isQuietSuppressed(
  windows: QuietHours[],
  severity: QuietSeverity,
  now: number
): boolean {
  const w = activeQuietWindow(windows, now)
  if (!w) return false
  if (w.severityCap === 'critical') return severity !== 'critical'
  return true
}

/**
 * Unix-ms instant at which the given active window's current occurrence ends.
 * Computed as an offset from `now` (minutes until the end boundary) so it
 * never has to reconstruct a wall-clock instant in an arbitrary timezone.
 * Assumes `window` is active at `now` (callers pass `activeQuietWindow(...)`).
 */
export function quietWindowEndMs(window: QuietHours, now: number): number {
  const startMin = parseHmToMinutes(window.start) ?? 0
  const endMin = parseHmToMinutes(window.end) ?? 0
  const zoned = zonedWeekdayMinutes(now, window.timezone)
  const cur = zoned?.minutes ?? 0

  let minutesUntilEnd: number
  if (startMin < endMin) {
    minutesUntilEnd = endMin - cur
  } else if (cur >= startMin) {
    // Evening portion of an across-midnight window — end is tomorrow morning.
    minutesUntilEnd = 1440 - cur + endMin
  } else {
    // Morning portion — end is later today.
    minutesUntilEnd = endMin - cur
  }
  if (minutesUntilEnd < 0) minutesUntilEnd = 0
  return now + minutesUntilEnd * 60_000
}

// ---------------------------------------------------------------------------
// Catch-up tracker — remembers criticals suppressed during a quiet window so
// the sweep can label the (naturally re-delivered) notification once the
// window closes. In-memory + module-level, like `alert-state-store.ts`; keyed
// by `${hostId}:${ruleId}`.
// ---------------------------------------------------------------------------
interface CatchUpMarker {
  severity: QuietSeverity
  /** unix ms the covering window ends — catch-up is due once now >= this. */
  windowEnd: number
}
const catchUpTracker = new Map<string, CatchUpMarker>()

function catchUpKey(hostId: number, ruleId: string): string {
  return `${hostId}:${ruleId}`
}

/** Record that a critical was suppressed by a window ending at `windowEnd`. */
export function markQuietSuppression(
  hostId: number,
  ruleId: string,
  severity: QuietSeverity,
  windowEnd: number
): void {
  catchUpTracker.set(catchUpKey(hostId, ruleId), { severity, windowEnd })
}

/**
 * If a suppressed critical is now due for catch-up (its window has ended),
 * consume and return true; otherwise false. Consuming (delete-on-take) means a
 * catch-up fires exactly once per suppression episode.
 */
export function takeDueCatchUp(
  hostId: number,
  ruleId: string,
  now: number
): boolean {
  const key = catchUpKey(hostId, ruleId)
  const marker = catchUpTracker.get(key)
  if (!marker) return false
  if (now >= marker.windowEnd) {
    catchUpTracker.delete(key)
    return true
  }
  return false
}

/** Drop any pending catch-up marker (e.g. the condition recovered). */
export function clearQuietSuppression(hostId: number, ruleId: string): void {
  catchUpTracker.delete(catchUpKey(hostId, ruleId))
}

/** Test-only: reset the module-level catch-up tracker between cases. */
export function _resetQuietCatchUpTracker(): void {
  catchUpTracker.clear()
}

// ---------------------------------------------------------------------------
// D1-backed store — mirrors maintenance-windows.ts.
// ---------------------------------------------------------------------------

function getDb(): D1Database | null {
  const bindings = getPlatformBindings()
  for (const name of D1_BINDING_NAMES) {
    const db = bindings.getD1Database(name)
    if (db) return db
  }
  return null
}

// Single-flight migration: concurrent first calls share one promise so the
// idempotent DDL runs at most once; a failure clears it so the next call retries.
let migration: Promise<void> | null = null

function ensureMigrated(db: D1Database): Promise<void> {
  if (!migration) {
    migration = (async () => {
      try {
        await db.batch([db.prepare(MIGRATION_SQL), db.prepare(INDEX_SQL)])
      } catch (err) {
        migration = null
        throw err
      }
    })()
  }
  return migration
}

// Best-effort 30s per-owner cache, so a health sweep tick doesn't pay a D1 read
// for every host/rule combination. A create/delete invalidates the owner's entry.
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { windows: QuietHours[]; expiresAt: number }>()

function invalidateCache(ownerId: string): void {
  cache.delete(ownerId)
}

/** Validate + normalize create input; throws on malformed values. */
function validateInput(input: CreateQuietHoursInput): void {
  const days = input.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (days.length === 0) {
    throw new Error('days must contain at least one weekday (0–6)')
  }
  if (parseHmToMinutes(input.start) === null) {
    throw new Error('start must be a valid HH:mm time')
  }
  if (parseHmToMinutes(input.end) === null) {
    throw new Error('end must be a valid HH:mm time')
  }
  if (input.start === input.end) {
    throw new Error('start and end must differ')
  }
  // Reject an invalid IANA timezone up front (Intl throws on a bad zone).
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone })
  } catch {
    throw new Error(`invalid timezone: ${input.timezone}`)
  }
}

/**
 * List every quiet-hours window for an owner. Best-effort: degrades to `[]`
 * when no D1 binding resolves or the read fails.
 */
export async function listQuietHours(ownerId: string): Promise<QuietHours[]> {
  const cached = cache.get(ownerId)
  if (cached && cached.expiresAt > Date.now()) return cached.windows

  try {
    const db = getDb()
    if (!db) return []
    await ensureMigrated(db)

    const result = await db
      .prepare(
        `SELECT id, owner_id, days, start_time, end_time, timezone, severity_cap, created_by, created_at
         FROM ${TABLE}
         WHERE owner_id = ?1
         ORDER BY created_at DESC`
      )
      .bind(ownerId)
      .all<D1QuietRow>()

    const windows = (result.results ?? []).map(rowToQuietHours)
    cache.set(ownerId, { windows, expiresAt: Date.now() + CACHE_TTL_MS })
    return windows
  } catch (err) {
    warn(`failed to list quiet hours for owner ${ownerId}: ${err}`)
    return []
  }
}

/**
 * Create a quiet-hours window. Validates the input (throws → caller surfaces a
 * 400); a D1/binding failure also throws so the CRUD route reports the write
 * didn't happen (unlike the read/suppression paths, which fail open).
 */
export async function createQuietHours(
  input: CreateQuietHoursInput
): Promise<QuietHours> {
  validateInput(input)

  const db = getDb()
  if (!db) {
    throw new Error('No D1 binding (MAINTENANCE_D1 / CHM_CLOUD_D1) found')
  }
  await ensureMigrated(db)

  const days = [...new Set(input.days)].sort((a, b) => a - b)
  const window: QuietHours = {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    days,
    start: input.start,
    end: input.end,
    timezone: input.timezone,
    severityCap: input.severityCap,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  }

  await db
    .prepare(
      `INSERT INTO ${TABLE}
         (id, owner_id, days, start_time, end_time, timezone, severity_cap, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      window.id,
      window.ownerId,
      JSON.stringify(window.days),
      window.start,
      window.end,
      window.timezone,
      window.severityCap,
      window.createdBy,
      window.createdAt
    )
    .run()

  invalidateCache(input.ownerId)
  return window
}

/**
 * Delete a quiet-hours window, scoped to its owner. Best-effort: a D1 failure
 * is swallowed (logged) rather than thrown, matching the read/suppression
 * paths' fail-open posture.
 */
export async function deleteQuietHours(
  ownerId: string,
  id: string
): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await ensureMigrated(db)

    await db
      .prepare(`DELETE FROM ${TABLE} WHERE id = ?1 AND owner_id = ?2`)
      .bind(id, ownerId)
      .run()

    invalidateCache(ownerId)
  } catch (err) {
    warn(`failed to delete quiet hours ${id} for owner ${ownerId}: ${err}`)
  }
}
