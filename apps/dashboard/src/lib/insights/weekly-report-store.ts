/**
 * D1-backed store for persisted weekly health reports.
 *
 * Mirrors the insights D1 store pattern (`store/d1-store.ts`): the table is
 * created lazily (`CREATE TABLE IF NOT EXISTS`) on first use so persistence
 * works even if the checked-in migration (`db/conversations-migrations/
 * 0014_weekly_reports.sql`) hasn't run yet or a different D1 binding is used —
 * `IF NOT EXISTS` makes the two idempotent together. Reuses the same
 * `CHM_CLOUD_D1` binding as the agent's conversation store and the anomaly
 * baseline store.
 *
 * Best-effort like every other insights backend: a missing binding or any D1
 * error is caught, logged, and resolved to `false` / `null` / `[]` rather than
 * thrown — so a deployment with no D1 configured (the OSS/self-hosted default)
 * simply never persists a weekly report rather than crashing the cron. See
 * plans/52-proactive-weekly-health-report.md.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'weekly-report-store'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[weekly-report-store] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'weekly_reports'

// Kept byte-for-byte in sync with db/conversations-migrations/0014_weekly_reports.sql.
const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    host_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    html TEXT NOT NULL DEFAULT '',
    delivered INTEGER NOT NULL DEFAULT 0,
    generated_at INTEGER NOT NULL,
    PRIMARY KEY (host_id, week_start)
  )
`

/** A persisted weekly report row, keyed by (hostId, weekStart). */
export interface WeeklyReportRecord {
  readonly hostId: string
  /** Start of the rolling 7-day window this report covers, `YYYY-MM-DD`. */
  readonly weekStart: string
  /** JSON-serialized `WeeklyReportSummary` (see `weekly-report.ts`). */
  readonly summaryJson: string
  /** Rendered, self-contained HTML narrative (see `weekly-report-html.ts`). */
  readonly html: string
  readonly delivered: boolean
  /** Unix epoch milliseconds this report was generated. */
  readonly generatedAt: number
}

interface D1WeeklyReportRow {
  host_id: string
  week_start: string
  summary_json: string
  html: string
  delivered: number
  generated_at: number
}

function rowToRecord(row: D1WeeklyReportRow): WeeklyReportRecord {
  return {
    hostId: row.host_id,
    weekStart: row.week_start,
    summaryJson: row.summary_json,
    html: row.html ?? '',
    delivered: row.delivered === 1,
    generatedAt: row.generated_at,
  }
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

// Single-flight migration: concurrent first calls share one promise so the
// idempotent DDL runs at most once per process; a failure clears it so the
// next call retries.
let migration: Promise<void> | null = null

function ensureMigrated(db: D1Database): Promise<void> {
  if (!migration) {
    migration = db
      .prepare(MIGRATION_SQL)
      .run()
      .then(() => undefined)
      .catch((err) => {
        migration = null
        throw err
      })
  }
  return migration
}

/**
 * Upsert a weekly report (keyed on host_id + week_start) — re-running the
 * cron for the same host/week (e.g. a retry, or a later delivery-status
 * update) overwrites the existing row instead of duplicating it.
 * Best-effort: returns `false` on any failure, never throws.
 */
export async function persistWeeklyReport(
  record: WeeklyReportRecord
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) {
      warn('no D1 binding (CHM_CLOUD_D1) found — report not persisted')
      return false
    }
    await ensureMigrated(db)

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (host_id, week_start, summary_json, html, delivered, generated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (host_id, week_start) DO UPDATE SET
           summary_json = excluded.summary_json,
           html = excluded.html,
           delivered = excluded.delivered,
           generated_at = excluded.generated_at`
      )
      .bind(
        record.hostId,
        record.weekStart,
        record.summaryJson,
        record.html,
        record.delivered ? 1 : 0,
        record.generatedAt
      )
      .run()
    return true
  } catch (err) {
    warn(
      `failed to persist weekly report for ${record.hostId}/${record.weekStart}: ${err}`
    )
    return false
  }
}

/**
 * Read the persisted report for a host/week.
 * Returns `null` when none exists yet, D1 is unavailable, or the read fails.
 */
export async function getWeeklyReport(
  hostId: string,
  weekStart: string
): Promise<WeeklyReportRecord | null> {
  try {
    const db = getDb()
    if (!db) return null
    await ensureMigrated(db)

    const row = await db
      .prepare(
        `SELECT host_id, week_start, summary_json, html, delivered, generated_at
         FROM ${TABLE} WHERE host_id = ?1 AND week_start = ?2`
      )
      .bind(hostId, weekStart)
      .first<D1WeeklyReportRow>()

    return row ? rowToRecord(row) : null
  } catch (err) {
    warn(`failed to read weekly report for ${hostId}/${weekStart}: ${err}`)
    return null
  }
}

/**
 * List recent persisted reports for a host, newest first.
 * Best-effort — returns `[]` on any failure.
 */
export async function listWeeklyReports(
  hostId: string,
  limit = 12
): Promise<WeeklyReportRecord[]> {
  try {
    const db = getDb()
    if (!db) return []
    await ensureMigrated(db)

    const result = await db
      .prepare(
        `SELECT host_id, week_start, summary_json, html, delivered, generated_at
         FROM ${TABLE} WHERE host_id = ?1
         ORDER BY week_start DESC
         LIMIT ?2`
      )
      .bind(hostId, Math.min(Math.max(Math.trunc(limit) || 0, 1), 100))
      .all<D1WeeklyReportRow>()

    return (result.results ?? []).map(rowToRecord)
  } catch (err) {
    warn(`failed to list weekly reports for ${hostId}: ${err}`)
    return []
  }
}

/** Test-only: clear the memoized migration promise so the next call retries. */
export function resetWeeklyReportMigrationCache(): void {
  migration = null
}
