/**
 * On-demand report generation — POST /api/v1/reports/generate (#2790)
 *
 * The "Generate now → download" path, available on OSS and Cloud alike
 * (generation is never plan- or cloud-gated; only *scheduled delivery* is).
 * Builds a fresh report for one host over the requested cadence window,
 * persists it (so it also appears in GET /api/v1/insights/weekly-report
 * history), and returns the HTML + summary for immediate viewing/download.
 *
 * Body: { host?: number, period?: 'weekly' | 'monthly' }
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { buildWeeklyReport } from '@/lib/insights/weekly-report'
import { persistWeeklyReport } from '@/lib/insights/weekly-report-store'
import { getHost } from '@/lib/utils'

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

async function handlePost(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'read' },
    request
  )
  if (permissionResponse) return permissionResponse

  let body: { host?: unknown; period?: unknown } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // Empty body is fine — defaults below.
  }

  const hostId = Number.parseInt(String(body.host ?? 0), 10)
  if (!Number.isInteger(hostId) || hostId < 0) {
    return jsonError('host must be a non-negative integer', 400)
  }
  const period = body.period === 'monthly' ? 'monthly' : 'weekly'

  const bindings = env as Record<string, string | undefined>
  bridgeClickHouseEnv(bindings)
  const cfg = getClickHouseConfigsFromEnv(bindings).find((c) => c.id === hostId)
  if (!cfg) {
    return jsonError(`host ${hostId} is not configured`, 404)
  }

  try {
    const label = cfg.customName || getHost(cfg.host) || `Host ${hostId}`
    const report = await buildWeeklyReport(hostId, label, period)

    // Best-effort persistence so on-demand reports join the history.
    await persistWeeklyReport({
      hostId: String(hostId),
      weekStart: report.summary.weekStart,
      summaryJson: JSON.stringify(report.summary),
      html: report.html,
      delivered: false,
      generatedAt: Date.now(),
    })

    return Response.json({
      success: true,
      summary: report.summary,
      html: report.html,
    })
  } catch (err) {
    error('[POST /api/v1/reports/generate] failed', err as Error)
    return jsonError(
      err instanceof Error ? err.message : 'Report generation failed',
      500
    )
  }
}

export const Route = createFileRoute('/api/v1/reports/generate')({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
    },
  },
})
