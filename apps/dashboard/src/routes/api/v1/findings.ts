/**
 * Findings API endpoint
 * GET /api/v1/findings
 *
 * Returns recently recorded monitoring findings for a host (newest first).
 * Findings are produced by autonomous checks (cron health-sweep, the agent's
 * record_finding tool) and persisted in the app-owned findings table.
 *
 * Query parameters:
 * - host (optional, default 0): Host to read findings from
 * - severity (optional): Filter to "info" | "warning" | "critical"
 * - since (optional): Time window, e.g. "24 HOUR", "7 DAY"
 * - limit (optional, default 100, max 1000): Max findings to return
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error, generateRequestId } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { FINDINGS_TABLE } from '@/lib/app-tables'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

type FindingSeverity = 'info' | 'warning' | 'critical'

interface FindingRow {
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

interface ListFindingsOptions {
  severity?: FindingSeverity
  /** ClickHouse time expression to bound the lower edge, e.g. "24 HOUR", "7 DAY". */
  since?: string
  limit?: number
}

const VALID_SEVERITIES = new Set<FindingSeverity>([
  'info',
  'warning',
  'critical',
])

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

async function listRecentFindings(
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
    if (sanitized) {
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
    return []
  }

  return result.data ?? []
}

export const Route = createFileRoute('/api/v1/findings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const requestId = generateRequestId()

        try {
          const searchParams = new URL(request.url).searchParams

          const hostId = Number.parseInt(searchParams.get('host') ?? '0', 10)
          if (!Number.isInteger(hostId) || hostId < 0) {
            return Response.json(
              {
                error: 'Invalid host parameter: must be a non-negative integer',
              },
              { status: 400, headers: { 'X-Request-ID': requestId } }
            )
          }

          // Cloud demo-hiding invariant (#2172): user connections always use
          // negative hostIds, so a non-negative id from a signed-in cloud
          // principal can only be the hidden env/demo host. No-op for OSS
          // and anonymous cloud callers (both legitimately use host=0).
          if (await isDemoHostBlockedForRequest(hostId, bindings)) {
            return Response.json(
              {
                findings: [],
                count: 0,
                unavailable: {
                  reason: 'demo_hidden',
                  message: 'The demo host is hidden for signed-in accounts.',
                },
              },
              { headers: { 'X-Request-ID': requestId } }
            )
          }

          const severityParam = searchParams.get('severity') ?? undefined
          if (
            severityParam &&
            !VALID_SEVERITIES.has(severityParam as FindingSeverity)
          ) {
            return Response.json(
              { error: 'Invalid severity: must be info, warning, or critical' },
              { status: 400, headers: { 'X-Request-ID': requestId } }
            )
          }

          const since = searchParams.get('since') ?? undefined
          const limitParam = searchParams.get('limit')
          const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined

          debug('[GET /api/v1/findings] Fetching findings', {
            requestId,
            hostId,
            severity: severityParam,
            since,
            limit,
          })

          // A read must not run DDL. The findings table is created by the
          // write path (`recordFinding` in lib/findings/findings-store.ts) and
          // by the cron sweep; when it does not exist yet, listRecentFindings
          // returns [] on the query error, so GET stays side-effect free.
          const findings = await listRecentFindings(hostId, {
            severity: severityParam as FindingSeverity | undefined,
            since,
            limit,
          })

          return Response.json(
            { findings, count: findings.length },
            { headers: { 'X-Request-ID': requestId } }
          )
        } catch (err) {
          error('[GET /api/v1/findings] Unexpected error:', err, { requestId })
          return Response.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500, headers: { 'X-Request-ID': requestId } }
          )
        }
      },
    },
  },
})
