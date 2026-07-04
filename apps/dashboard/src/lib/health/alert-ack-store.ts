/**
 * Minimal alert-acknowledgement store (D1).
 *
 * Records that a firing alert was acknowledged by an actor (initially: a Slack
 * user clicking the "Acknowledge" button on a pushed alert — plans/37). One row
 * per alert dedup key (`host:rule[:severity]`), in the shared `CHM_CLOUD_D1`
 * database (`alert_acks` table, 0015 migration).
 *
 * DELIBERATELY MINIMAL. Roadmap 29 (alert ACK / manual resolution) owns the
 * fuller ACK state model — including feeding back into the sweep's dedup so an
 * acked condition suppresses reminders. This store does NOT touch
 * `alert-state-store.ts`; wiring that coupling here would be inventing a
 * parallel state store (explicitly called out as drift in the plan). When
 * roadmap 29 lands it should SUBSUME this table. Kept source-agnostic (`source`
 * column) so it is not Slack-only.
 *
 * Best-effort like the sibling health/insights D1 backends: a missing binding
 * (OSS default with no D1) or any error is caught, logged, and resolved to
 * false/null — never thrown.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-ack-store] ${msg}`, {
    component: 'alert-ack-store',
  })

const TABLE = 'alert_acks'

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

export interface AlertAck {
  /** Stable dedup key for the alert, e.g. "0:failed-mutations:critical". */
  ackKey: string
  hostId?: number | null
  ruleId?: string | null
  severity?: string | null
  /** Actor id (e.g. a Slack user id). */
  ackedBy: string
  ackedByName?: string | null
  /** Where the ACK originated, e.g. 'slack'. */
  source: string
  /** Unix ms. */
  ackedAt: number
}

interface D1AckRow {
  ack_key: string
  host_id: number | null
  rule_id: string | null
  severity: string | null
  acked_by: string
  acked_by_name: string | null
  source: string
  acked_at: number
}

/**
 * Record an acknowledgement. Idempotent per `ack_key` (a repeated click / a
 * re-ack updates the actor + timestamp in place). Returns false on any failure
 * — never throws.
 */
export async function recordAlertAck(ack: AlertAck): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (ack_key, host_id, rule_id, severity, acked_by, acked_by_name, source, acked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (ack_key) DO UPDATE SET
           acked_by = excluded.acked_by,
           acked_by_name = excluded.acked_by_name,
           source = excluded.source,
           acked_at = excluded.acked_at`
      )
      .bind(
        ack.ackKey,
        ack.hostId ?? null,
        ack.ruleId ?? null,
        ack.severity ?? null,
        ack.ackedBy,
        ack.ackedByName ?? null,
        ack.source,
        ack.ackedAt
      )
      .run()
    return true
  } catch (err) {
    warn(`failed to record ack ${ack.ackKey}: ${err}`)
    return false
  }
}

/** Look up an acknowledgement by key, or null if none / on failure. */
export async function getAlertAck(ackKey: string): Promise<AlertAck | null> {
  try {
    const db = getDb()
    if (!db) return null
    const row = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE ack_key = ?1`)
      .bind(ackKey)
      .first<D1AckRow>()
    if (!row) return null
    return {
      ackKey: row.ack_key,
      hostId: row.host_id,
      ruleId: row.rule_id,
      severity: row.severity,
      ackedBy: row.acked_by,
      ackedByName: row.acked_by_name,
      source: row.source,
      ackedAt: row.acked_at,
    }
  } catch (err) {
    warn(`failed to get ack ${ackKey}: ${err}`)
    return null
  }
}
