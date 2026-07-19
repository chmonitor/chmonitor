/**
 * D1-backed store for per-owner scheduled report subscriptions (#2783).
 *
 * One row per owner: cadence (off/weekly/monthly), covered env host ids, and
 * a lightweight delivery audit (last attempt time + status). Follows the
 * shared owner-id convention ('' = OSS single-tenant, Clerk id in cloud) and
 * the weekly-report-store pattern: lazy `CREATE TABLE IF NOT EXISTS` kept
 * byte-for-byte in sync with `db/conversations-migrations/
 * 0029_report_subscriptions.sql`, `CHM_CLOUD_D1` binding, and fail-open on
 * any D1 error (missing binding → reads return null/[], writes return false).
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'report-subscription-store'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[report-subscription-store] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'report_subscriptions'

// Kept byte-for-byte in sync with db/conversations-migrations/0029_report_subscriptions.sql.
const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    owner_id TEXT NOT NULL PRIMARY KEY,
    cadence TEXT NOT NULL DEFAULT 'off',
    host_ids TEXT NOT NULL DEFAULT '0',
    last_sent_at INTEGER,
    last_status TEXT,
    updated_at INTEGER NOT NULL
  )
`

export const REPORT_CADENCES = ['off', 'weekly', 'monthly'] as const
export type ReportCadence = (typeof REPORT_CADENCES)[number]

export function isReportCadence(value: unknown): value is ReportCadence {
  return REPORT_CADENCES.includes(value as ReportCadence)
}

export interface ReportSubscription {
  readonly ownerId: string
  readonly cadence: ReportCadence
  /** Env host indices this subscription covers (deduped, sorted). */
  readonly hostIds: number[]
  /** Unix epoch ms of the last delivery attempt, or null if never sent. */
  readonly lastSentAt: number | null
  /** Compact status of the last attempt, e.g. `email:ok telegram:fail`. */
  readonly lastStatus: string | null
  readonly updatedAt: number
}

interface D1SubscriptionRow {
  owner_id: string
  cadence: string
  host_ids: string
  last_sent_at: number | null
  last_status: string | null
  updated_at: number
}

function parseHostIds(raw: string): number[] {
  const seen = new Set<number>()
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10)
    if (Number.isInteger(n) && n >= 0) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

function toSubscription(row: D1SubscriptionRow): ReportSubscription {
  return {
    ownerId: row.owner_id,
    cadence: isReportCadence(row.cadence) ? row.cadence : 'off',
    hostIds: parseHostIds(row.host_ids),
    lastSentAt: row.last_sent_at,
    lastStatus: row.last_status,
    updatedAt: row.updated_at,
  }
}

// Single-flight migration, mirroring weekly-report-store.ts: concurrent first
// calls share one promise; a failure clears it so the next call retries.
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

async function getDb(): Promise<D1Database | null> {
  try {
    const db = getPlatformBindings().getD1Database('CHM_CLOUD_D1')
    if (!db) return null
    await ensureMigrated(db)
    return db
  } catch (err) {
    warn(`D1 unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export async function getReportSubscription(
  ownerId: string
): Promise<ReportSubscription | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const row = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE owner_id = ?`)
      .bind(ownerId)
      .first<D1SubscriptionRow>()
    return row ? toSubscription(row) : null
  } catch (err) {
    warn(`read failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Upsert an owner's cadence + host selection (audit fields untouched). */
export async function saveReportSubscription(
  ownerId: string,
  cadence: ReportCadence,
  hostIds: number[]
): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  try {
    await db
      .prepare(
        `INSERT INTO ${TABLE} (owner_id, cadence, host_ids, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           cadence = excluded.cadence,
           host_ids = excluded.host_ids,
           updated_at = excluded.updated_at`
      )
      .bind(ownerId, cadence, hostIds.join(','), Date.now())
      .run()
    return true
  } catch (err) {
    warn(`write failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** Record the outcome of a delivery attempt (best-effort audit, #2789). */
export async function recordReportDelivery(
  ownerId: string,
  status: string
): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  try {
    await db
      .prepare(
        `UPDATE ${TABLE} SET last_sent_at = ?, last_status = ? WHERE owner_id = ?`
      )
      .bind(Date.now(), status.slice(0, 500), ownerId)
      .run()
    return true
  } catch (err) {
    warn(`audit failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** All subscriptions with the given cadence (for the cron fan-out). */
export async function listSubscriptionsByCadence(
  cadence: Exclude<ReportCadence, 'off'>
): Promise<ReportSubscription[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const { results } = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE cadence = ?`)
      .bind(cadence)
      .all<D1SubscriptionRow>()
    return (results ?? []).map(toSubscription)
  } catch (err) {
    warn(`list failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}
