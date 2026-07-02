/**
 * Findings store — persistence foundation for autonomous monitoring.
 *
 * Autonomous checks (the cron health-sweep, the agent's anomaly/incident tools)
 * produce *findings*: a short, structured record of something noteworthy on a
 * cluster. This module owns an app-created ClickHouse table for those records
 * and exposes best-effort read/write helpers.
 *
 * The table is created lazily (CREATE TABLE IF NOT EXISTS). Every write is
 * guarded: if the monitoring user is read-only or the table cannot be created,
 * we log and return false instead of throwing so callers degrade silently.
 *
 * Ported from apps/dashboard/lib/findings/findings-store.ts.
 * `import 'server-only'` removed — not a Next.js concept in TanStack Start.
 * This module must only be imported by server route handlers (src/routes/api/**).
 */

import { fetchData, getClient } from '@chm/clickhouse-client'
import { ErrorLogger } from '@chm/logger'
import { FINDINGS_TABLE } from '@/lib/app-tables'

const COMPONENT = 'findings-store'

const log = (msg: string) =>
  ErrorLogger.logDebug(`[findings-store] ${msg}`, { component: COMPONENT })
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[findings-store] ${msg}`, { component: COMPONENT })

/**
 * DDL for the app-owned findings table.
 *
 * MergeTree ordered by event_time with a 30-day TTL — findings are transient
 * operational signals, not long-term history.
 */
const CREATE_FINDINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${FINDINGS_TABLE} (
    event_time DateTime DEFAULT now(),
    host_id String,
    severity LowCardinality(String),
    category LowCardinality(String),
    source LowCardinality(String),
    title String,
    detail String,
    metric String,
    value Float64
  ) ENGINE = MergeTree
  ORDER BY event_time
  TTL event_time + INTERVAL 30 DAY
`

export type FindingSeverity = 'info' | 'warning' | 'critical'

export interface Finding {
  severity: FindingSeverity
  category: string
  source: string
  title: string
  detail?: string
  metric?: string
  value?: number
}

export interface FindingRow {
  event_time: string
  host_id: string
  severity: string
  category: string
  source: string
  title: string
  detail: string
  metric: string
  value: number
}

export interface ListFindingsOptions {
  severity?: FindingSeverity
  /** ClickHouse time expression to bound the lower edge, e.g. "24 HOUR", "7 DAY". */
  since?: string
  limit?: number
}

// Per-host guard so we only attempt CREATE TABLE once per process per host.
const ensuredHosts = new Set<number>()

/**
 * Best-effort CREATE TABLE IF NOT EXISTS. Never throws; returns whether the
 * table is believed to exist after the call.
 */
async function ensureTable(hostId: number): Promise<boolean> {
  if (ensuredHosts.has(hostId)) return true

  try {
    const client = await getClient({ hostId })
    await client.command({ query: CREATE_FINDINGS_TABLE })
    ensuredHosts.add(hostId)
    log(`ensured ${FINDINGS_TABLE} on host ${hostId}`)
    return true
  } catch (err) {
    warn(
      `could not ensure ${FINDINGS_TABLE} on host ${hostId} (read-only?): ${err}`
    )
    return false
  }
}

/**
 * Sanitize a ClickHouse interval expression like "24 HOUR" / "7 DAY".
 * Returns the normalized expression or null when invalid.
 */
function sanitizeSince(value: string): string | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,5})\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH)S?$/)
  if (!match) return null
  return `${match[1]} ${match[2]}`
}

/**
 * Persist a single finding. Best-effort: creates the table if needed and
 * inserts one row. On read-only clusters or any failure it logs and returns
 * false so autonomous callers never break.
 */
export async function recordFinding(
  hostId: number,
  finding: Finding
): Promise<boolean> {
  const ready = await ensureTable(hostId)
  if (!ready) return false

  try {
    const client = await getClient({ hostId })
    await client.insert({
      table: FINDINGS_TABLE,
      format: 'JSONEachRow',
      values: [
        {
          host_id: String(hostId),
          severity: finding.severity,
          category: finding.category,
          source: finding.source,
          title: finding.title,
          detail: finding.detail ?? '',
          metric: finding.metric ?? '',
          value: finding.value ?? 0,
        },
      ],
    })
    log(`recorded finding "${finding.title}" on host ${hostId}`)
    return true
  } catch (err) {
    warn(`failed to record finding on host ${hostId}: ${err}`)
    return false
  }
}

/**
 * Read recent findings for a host, newest first. Best-effort: returns an empty
 * array if the table is missing or unreadable.
 */
export async function listRecentFindings(
  hostId: number,
  opts: ListFindingsOptions = {}
): Promise<FindingRow[]> {
  const { severity, since, limit = 100 } = opts

  const conditions: string[] = ['host_id = {hostId:String}']
  const query_params: Record<string, unknown> = { hostId: String(hostId) }

  if (severity) {
    conditions.push('severity = {severity:String}')
    query_params.severity = severity
  }

  if (since) {
    const sanitized = sanitizeSince(since)
    if (!sanitized) {
      warn(`ignoring invalid "since" value: ${since}`)
    } else {
      conditions.push(`event_time >= now() - INTERVAL ${sanitized}`)
    }
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 0, 1), 1000)

  // Filter and order on the real DateTime `event_time` column inside a
  // subquery, then format it to a string in the outer SELECT. Formatting in
  // the same SELECT that filters/orders would shadow the DateTime column with
  // a String alias, so `event_time >= now() - INTERVAL ...` and
  // `ORDER BY event_time` compare String vs DateTime → Code 386 NO_COMMON_TYPE.
  const sql = `
    SELECT
      toString(event_time) AS event_time,
      host_id,
      severity,
      category,
      source,
      title,
      detail,
      metric,
      value
    FROM (
      SELECT
        event_time,
        host_id,
        severity,
        category,
        source,
        title,
        detail,
        metric,
        value
      FROM ${FINDINGS_TABLE}
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_time DESC
      LIMIT ${safeLimit}
    )
  `

  const result = await fetchData<FindingRow[]>({
    query: sql,
    hostId,
    format: 'JSONEachRow',
    query_params,
    clickhouse_settings: { readonly: '1' },
  })

  if (result.error) {
    warn(`failed to list findings on host ${hostId}: ${result.error.message}`)
    return []
  }

  return result.data ?? []
}
