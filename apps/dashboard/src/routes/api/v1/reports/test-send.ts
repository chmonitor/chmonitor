/**
 * "Send test report now" — POST /api/v1/reports/test-send (#2790)
 *
 * Builds a fresh report for one host and delivers it immediately to the
 * caller's configured alert channels (same path the cron fan-out uses), so a
 * user can verify their channels before trusting the schedule. Returns the
 * per-channel outcome. Owner-scoped; cloud requires sign-in (it triggers
 * outbound sends on the caller's behalf).
 *
 * Body: { host?: number, period?: 'weekly' | 'monthly' }
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import {
  deliverReport,
  formatDeliveryStatus,
} from '@/lib/insights/report-delivery'
import { recordReportDelivery } from '@/lib/insights/report-subscription-store'
import { buildWeeklyReport } from '@/lib/insights/weekly-report'
import { getHost } from '@/lib/utils'

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

async function handlePost(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
    request
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to send a test report.', 401)
  }

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
    const outcome = await deliverReport(ownerId, report)
    await recordReportDelivery(ownerId, `test ${formatDeliveryStatus(outcome)}`)

    return Response.json({
      success: true,
      channelConfigured: outcome.channelConfigured,
      delivered: outcome.delivered,
      channels: outcome.channels,
    })
  } catch (err) {
    error('[POST /api/v1/reports/test-send] failed', err as Error)
    return jsonError(
      err instanceof Error ? err.message : 'Test send failed',
      500
    )
  }
}

export const Route = createFileRoute('/api/v1/reports/test-send')({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
    },
  },
})
