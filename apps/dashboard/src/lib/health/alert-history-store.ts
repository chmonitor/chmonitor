/**
 * D1-backed audit log of dispatched health-sweep alerts.
 *
 * Persists one row per attempted webhook delivery (`server-sweep.ts`, right
 * after `postWebhook` resolves) so operators can see what fired, when, and
 * whether delivery succeeded — the in-memory dedup state
 * (`alert-state-store.ts`) only remembers the CURRENT condition per host/rule,
 * not history. Reuses the same `CHM_CLOUD_D1` binding as the agent's
 * conversation store and `insights/baseline-store.ts`; the table itself is
 * created by the `alert_events` migration in `db/conversations-migrations`.
 *
 * Best-effort like every other insights/health backend: a missing binding, an
 * unmigrated table, or any other D1 error is caught, logged, and resolved to
 * `void` / `[]` rather than thrown — so a deployment with no D1 configured
 * (the OSS/self-hosted default) simply never gets history, and the sweep's
 * outbound alert delivery is completely unaffected either way (see
 * plans/27-alert-history-audit-log.md).
 *
 * No owner/tenant column: `host_id` indexes the operator's env-configured
 * hosts (`getClickHouseConfigs()` reads `CLICKHOUSE_*` only, never per-user D1
 * connections), so every row is already scoped to whoever can reach
 * `/api/v1/health/*` at all — there is no per-user data to leak.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-history-store'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-history-store] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_events'

/** Sane caps so a runaway/unbounded query can't return unbounded rows. */
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export interface AlertEventRecord {
  id?: string
  eventTime: string
  hostId: number
  hostLabel?: string | null
  rule: string
  severity: 'warning' | 'critical' | 'recovery'
  prevSeverity?: 'warning' | 'critical' | 'recovery' | null
  decisionKind: string
  delivered: boolean
  error?: string | null
  value?: number | null
  channel?: string | null
  /**
   * For a grouped digest dispatch (#2663): the `"hostId:ruleId"` references of
   * every finding folded into this ONE row. `null`/absent for a normal
   * single-finding event.
   */
  findingRefs?: string[] | null
}

/** D1 row shape (snake_case columns, 0/1 delivered flag). */
interface D1AlertEventRow {
  id: string
  event_time: string
  host_id: number
  host_label: string | null
  rule: string
  severity: string
  prev_severity: string | null
  decision_kind: string
  delivered: number
  error: string | null
  value: number | null
  channel: string | null
  /** JSON array of `"hostId:ruleId"` refs for a digest row (#2663), else null. */
  finding_refs: string | null
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function rowToRecord(row: D1AlertEventRow): AlertEventRecord {
  return {
    id: row.id,
    eventTime: row.event_time,
    hostId: row.host_id,
    hostLabel: row.host_label,
    rule: row.rule,
    severity: row.severity as AlertEventRecord['severity'],
    prevSeverity: row.prev_severity as AlertEventRecord['prevSeverity'],
    decisionKind: row.decision_kind,
    delivered: row.delivered === 1,
    error: row.error,
    value: row.value,
    channel: row.channel,
    findingRefs: parseFindingRefs(row.finding_refs),
  }
}

/** Parse the stored `finding_refs` JSON into a string[], tolerating junk/null. */
function parseFindingRefs(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const refs = parsed.filter((r): r is string => typeof r === 'string')
    return refs.length > 0 ? refs : null
  } catch {
    return null
  }
}

/**
 * Best-effort append. NEVER throws — a D1 write failure (or a missing
 * binding, i.e. self-hosted/OSS with no D1 configured) is caught, logged, and
 * swallowed so the health sweep and its outbound alert delivery are never
 * affected by an audit-log failure.
 */
export async function recordAlertEvent(e: AlertEventRecord): Promise<void> {
  try {
    const db = getDb()
    if (!db) return

    const id = e.id ?? crypto.randomUUID()

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (id, event_time, host_id, host_label, rule, severity, prev_severity, decision_kind, delivered, error, value, channel, finding_refs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
      )
      .bind(
        id,
        e.eventTime,
        e.hostId,
        e.hostLabel ?? null,
        e.rule,
        e.severity,
        e.prevSeverity ?? null,
        e.decisionKind,
        e.delivered ? 1 : 0,
        e.error ?? null,
        e.value ?? null,
        e.channel ?? null,
        e.findingRefs && e.findingRefs.length > 0
          ? JSON.stringify(e.findingRefs)
          : null
      )
      .run()
  } catch (err) {
    warn(
      `failed to record alert event for host ${e.hostId} rule ${e.rule}: ${err}`
    )
  }
}

export interface AlertHistoryQuery {
  hostId?: number
  /** `YYYY-MM-DD` — matches the date prefix of `event_time`. */
  day?: string
  limit?: number
}

/**
 * List recent alert events, optionally filtered by host and/or day, newest
 * first. Best-effort — returns `[]` on any failure or when D1 is unavailable
 * (never throws).
 */
export async function queryAlertEvents(
  q: AlertHistoryQuery = {}
): Promise<AlertEventRecord[]> {
  try {
    const db = getDb()
    if (!db) return []

    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const conditions: string[] = []
    const params: unknown[] = []

    if (q.hostId !== undefined) {
      params.push(q.hostId)
      conditions.push(`host_id = ?${params.length}`)
    }
    if (q.day) {
      params.push(`${q.day}%`)
      conditions.push(`event_time LIKE ?${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(limit)

    const result = await db
      .prepare(
        `SELECT id, event_time, host_id, host_label, rule, severity, prev_severity, decision_kind, delivered, error, value, channel, finding_refs
         FROM ${TABLE} ${where}
         ORDER BY event_time DESC
         LIMIT ?${params.length}`
      )
      .bind(...params)
      .all<D1AlertEventRow>()

    return (result.results ?? []).map(rowToRecord)
  } catch (err) {
    warn(`failed to query alert events: ${err}`)
    return []
  }
}
