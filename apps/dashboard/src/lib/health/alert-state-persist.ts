/**
 * D1-backed persistence for the alert state machine (#2767).
 *
 * The transition/hysteresis engine in `alert-state-store.ts` keeps its working
 * set in an in-memory singleton. That is lost on every worker restart, which
 * would reset hysteresis streaks and incident timers mid-incident. To make the
 * last-known state per (check, host) durable, the sweep HYDRATES the memory
 * store from D1 at the start of a tick and FLUSHES it back at the end — the same
 * `CHM_CLOUD_D1` binding and lazy `CREATE TABLE IF NOT EXISTS` migration pattern
 * as `alert-ack-store.ts` / `alert-history-store.ts`.
 *
 * Best-effort like every other health D1 backend: a missing binding (the
 * self-hosted/OSS default), an unmigrated table, or any D1 error is caught,
 * logged, and swallowed — hydrate becomes a no-op and flush is dropped, so the
 * sweep degrades to the pre-#2767 ephemeral-memory behavior rather than
 * throwing. There is no owner/tenant column: `host_id` already scopes every row
 * to the operator's env-configured hosts (see `alert-history-store.ts`).
 */

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'
import type { AlertStateRecord, AlertStateStore } from './alert-state-store'

import { alertStateKey } from './alert-state-store'
import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-state-persist'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-state-persist] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_state'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    host_id          INTEGER NOT NULL,
    rule_id          TEXT    NOT NULL,
    severity         TEXT    NOT NULL,
    updated_at       INTEGER NOT NULL,
    notified_at      INTEGER NOT NULL,
    first_fired_at   INTEGER,
    pending_severity TEXT,
    pending_count    INTEGER,
    PRIMARY KEY (host_id, rule_id)
  )
`

/** Current alert state for one (host, rule) — the hydrated row shape for the UI. */
export interface AlertStateRow extends AlertStateRecord {
  hostId: number
  ruleId: string
}

interface D1AlertStateRow {
  host_id: number
  rule_id: string
  severity: string
  updated_at: number
  notified_at: number
  first_fired_at: number | null
  pending_severity: string | null
  pending_count: number | null
}

let migration: Promise<void> | null = null

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function ensureMigrated(db: D1Database): Promise<void> {
  if (!migration) {
    migration = (async () => {
      try {
        await db.prepare(MIGRATION_SQL).run()
      } catch (err) {
        migration = null
        throw err
      }
    })()
  }
  return migration
}

function rowToRecord(row: D1AlertStateRow): AlertStateRecord {
  const rec: AlertStateRecord = {
    severity: row.severity as AlertRuleSeverity,
    updatedAt: row.updated_at,
    notifiedAt: row.notified_at,
  }
  if (row.first_fired_at !== null) rec.firstFiredAt = row.first_fired_at
  if (row.pending_severity !== null) {
    rec.pendingSeverity = row.pending_severity as AlertRuleSeverity
  }
  if (row.pending_count !== null) rec.pendingCount = row.pending_count
  return rec
}

/**
 * Overlay every persisted state row onto `store` (D1 is authoritative for any
 * key it holds). Deliberately does NOT clear the store first: on a real restart
 * the in-memory store is already empty so an overlay == a full load, while on a
 * warm worker this refreshes from D1 without discarding a just-committed record
 * that a best-effort flush may not have persisted. Best-effort — a no-op when
 * D1 is unavailable, leaving the store as-is.
 */
export async function hydrateAlertState(store: AlertStateStore): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await ensureMigrated(db)
    const result = await db
      .prepare(
        `SELECT host_id, rule_id, severity, updated_at, notified_at, first_fired_at, pending_severity, pending_count
         FROM ${TABLE}`
      )
      .all<D1AlertStateRow>()
    for (const row of result.results ?? []) {
      store.set(alertStateKey(row.host_id, row.rule_id), rowToRecord(row))
    }
  } catch (err) {
    warn(`failed to hydrate alert state: ${err}`)
  }
}

/**
 * Persist the store's current contents to D1: upsert every live record and
 * delete rows for keys no longer present (recovered conditions clear their
 * record). Best-effort — dropped entirely on any D1 error.
 */
export async function flushAlertState(store: AlertStateStore): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await ensureMigrated(db)

    const live = new Set<string>()
    const statements: D1PreparedStatement[] = []
    for (const [key, rec] of store.entries()) {
      live.add(key)
      const [hostIdRaw, ...ruleParts] = key.split(':')
      const hostId = Number(hostIdRaw)
      const ruleId = ruleParts.join(':')
      if (!Number.isFinite(hostId) || ruleId === '') continue
      statements.push(
        db
          .prepare(
            `INSERT INTO ${TABLE}
               (host_id, rule_id, severity, updated_at, notified_at, first_fired_at, pending_severity, pending_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(host_id, rule_id) DO UPDATE SET
               severity = excluded.severity,
               updated_at = excluded.updated_at,
               notified_at = excluded.notified_at,
               first_fired_at = excluded.first_fired_at,
               pending_severity = excluded.pending_severity,
               pending_count = excluded.pending_count`
          )
          .bind(
            hostId,
            ruleId,
            rec.severity,
            rec.updatedAt,
            rec.notifiedAt,
            rec.firstFiredAt ?? null,
            rec.pendingSeverity ?? null,
            rec.pendingCount ?? null
          )
      )
    }

    // Delete any persisted rows whose key is no longer live (recovered).
    const existing = await db
      .prepare(`SELECT host_id, rule_id FROM ${TABLE}`)
      .all<{ host_id: number; rule_id: string }>()
    for (const row of existing.results ?? []) {
      if (!live.has(alertStateKey(row.host_id, row.rule_id))) {
        statements.push(
          db
            .prepare(`DELETE FROM ${TABLE} WHERE host_id = ?1 AND rule_id = ?2`)
            .bind(row.host_id, row.rule_id)
        )
      }
    }

    if (statements.length > 0) await db.batch(statements)
  } catch (err) {
    warn(`failed to flush alert state: ${err}`)
  }
}

/**
 * Read the current persisted alert state, newest transition first, optionally
 * filtered by host. Best-effort — returns `[]` when D1 is unavailable. Powers
 * the alert-settings "current state" UI (#2767).
 */
export async function readAlertStates(
  hostId?: number
): Promise<AlertStateRow[]> {
  try {
    const db = getDb()
    if (!db) return []
    await ensureMigrated(db)
    const base = `SELECT host_id, rule_id, severity, updated_at, notified_at, first_fired_at, pending_severity, pending_count FROM ${TABLE}`
    const stmt =
      hostId === undefined
        ? db.prepare(`${base} ORDER BY updated_at DESC`)
        : db
            .prepare(`${base} WHERE host_id = ?1 ORDER BY updated_at DESC`)
            .bind(hostId)
    const result = await stmt.all<D1AlertStateRow>()
    return (result.results ?? []).map((row) => ({
      hostId: row.host_id,
      ruleId: row.rule_id,
      ...rowToRecord(row),
    }))
  } catch (err) {
    warn(`failed to read alert states: ${err}`)
    return []
  }
}
