/**
 * Alert ACK / manual-resolution store (plan 29).
 *
 * An ACK on a `(ownerId, hostId, ruleId)` condition suppresses the health
 * sweep's dispatch for a bounded, operator-chosen duration — without touching
 * the dedup state in `alert-state-store.ts` (the underlying condition
 * transition is still tracked/committed as usual; ACK is a post-decision
 * dispatch gate, see `server-sweep.ts`).
 *
 * Reuses the same `CHM_CLOUD_D1` binding as the other health/insights D1
 * backends (mirrors `lib/insights/store/d1-store.ts`): the table is migrated
 * lazily on first use (idempotent `CREATE TABLE IF NOT EXISTS`, also shipped
 * as `db/conversations-migrations/0014_alert_acks.sql`), and every failure is
 * caught, logged, and swallowed so a missing/misconfigured binding (the
 * self-hosted/OSS default) degrades to "no acks" rather than throwing —
 * `isAcked([])` is always `false`, so the sweep and route never break.
 *
 * `ownerId` is `''` for OSS single-tenant deployments (no Clerk / no org).
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-ack-store'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-ack-store] ${msg}`, { component: COMPONENT })

const TABLE = 'alert_acks'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    owner_id    TEXT    NOT NULL,
    host_id     INTEGER NOT NULL,
    rule_id     TEXT    NOT NULL,
    acked_by    TEXT    NOT NULL DEFAULT '',
    acked_at    INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    note        TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (owner_id, host_id, rule_id)
  )
`
const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_${TABLE}_expiry ON ${TABLE} (owner_id, expires_at)
`

/** Whitelisted ACK durations (ms). Anything else is rejected by the route. */
export const ACK_DURATIONS_MS = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '60m': 60 * 60 * 1000,
  '240m': 240 * 60 * 1000,
} as const

export type AckDurationKey = keyof typeof ACK_DURATIONS_MS

export function isAckDurationKey(value: string): value is AckDurationKey {
  return value in ACK_DURATIONS_MS
}

export interface AlertAck {
  ownerId: string
  hostId: number
  ruleId: string
  ackedBy: string
  ackedAt: number
  expiresAt: number
  note: string
}

/** D1 row shape (snake_case columns). */
interface D1AlertAckRow {
  owner_id: string
  host_id: number
  rule_id: string
  acked_by: string
  acked_at: number
  expires_at: number
  note: string
}

function rowToAck(row: D1AlertAckRow): AlertAck {
  return {
    ownerId: row.owner_id,
    hostId: row.host_id,
    ruleId: row.rule_id,
    ackedBy: row.acked_by,
    ackedAt: row.acked_at,
    expiresAt: row.expires_at,
    note: row.note,
  }
}

// Single-flight migration, mirrors D1InsightsStore: concurrent first calls
// share one promise; a failure clears it so the next call retries.
let migration: Promise<void> | null = null

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

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

export interface AckAlertParams {
  ownerId: string
  hostId: number
  ruleId: string
  durationKey: AckDurationKey
  ackedBy: string
  note?: string
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number
}

/**
 * Upsert an ACK for a `(ownerId, hostId, ruleId)` condition. Re-ACKing an
 * already-acked condition replaces the actor/expiry/note (extend or shorten).
 * Throws on failure — callers (the route) decide how to surface that; the
 * sweep only ever calls `listActiveAcks`, which fails open.
 */
export async function ackAlert(params: AckAlertParams): Promise<AlertAck> {
  const db = getDb()
  if (!db) {
    throw new Error('No D1 binding (CHM_CLOUD_D1) configured for alert acks')
  }
  await ensureMigrated(db)

  const now = params.now ?? Date.now()
  const ack: AlertAck = {
    ownerId: params.ownerId,
    hostId: params.hostId,
    ruleId: params.ruleId,
    ackedBy: params.ackedBy,
    ackedAt: now,
    expiresAt: now + ACK_DURATIONS_MS[params.durationKey],
    note: params.note ?? '',
  }

  await db
    .prepare(
      `INSERT INTO ${TABLE}
         (owner_id, host_id, rule_id, acked_by, acked_at, expires_at, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(owner_id, host_id, rule_id) DO UPDATE SET
         acked_by = excluded.acked_by,
         acked_at = excluded.acked_at,
         expires_at = excluded.expires_at,
         note = excluded.note`
    )
    .bind(
      ack.ownerId,
      ack.hostId,
      ack.ruleId,
      ack.ackedBy,
      ack.ackedAt,
      ack.expiresAt,
      ack.note
    )
    .run()

  return ack
}

/**
 * List currently-active acks for an owner (`expires_at > now`). Best-effort —
 * returns `[]` on any failure (missing binding, unmigrated table, D1 error)
 * rather than throwing, so the sweep's suppression check fails open.
 */
export async function listActiveAcks(
  ownerId: string,
  now: number = Date.now()
): Promise<AlertAck[]> {
  try {
    const db = getDb()
    if (!db) return []
    await ensureMigrated(db)

    const result = await db
      .prepare(
        `SELECT owner_id, host_id, rule_id, acked_by, acked_at, expires_at, note
         FROM ${TABLE}
         WHERE owner_id = ?1 AND expires_at > ?2`
      )
      .bind(ownerId, now)
      .all<D1AlertAckRow>()

    return (result.results ?? []).map(rowToAck)
  } catch (err) {
    warn(`failed to list active acks for owner "${ownerId}": ${err}`)
    return []
  }
}

/**
 * Manually clear an ACK (un-ACK), or a best-effort clear on recovery (see
 * `server-sweep.ts`). Never throws — a failed clear just leaves a stale ACK
 * that expires naturally.
 */
export async function clearAck(
  ownerId: string,
  hostId: number,
  ruleId: string
): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await ensureMigrated(db)

    await db
      .prepare(
        `DELETE FROM ${TABLE} WHERE owner_id = ?1 AND host_id = ?2 AND rule_id = ?3`
      )
      .bind(ownerId, hostId, ruleId)
      .run()
  } catch (err) {
    warn(
      `failed to clear ack for owner "${ownerId}" host ${hostId} rule ${ruleId}: ${err}`
    )
  }
}

/**
 * Pure core: whether `(hostId, ruleId)` has an active (unexpired) ACK in the
 * given list. No I/O — exported separately so the suppression logic is fully
 * unit-testable without mocking D1, and so an empty list (no D1 binding, or a
 * failed `listActiveAcks`) trivially resolves to "not acked" everywhere.
 */
export function isAcked(
  acks: AlertAck[],
  hostId: number,
  ruleId: string,
  now: number
): boolean {
  return acks.some(
    (ack) =>
      ack.hostId === hostId && ack.ruleId === ruleId && ack.expiresAt > now
  )
}
