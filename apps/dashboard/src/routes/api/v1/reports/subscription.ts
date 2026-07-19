/**
 * Scheduled report subscription CRUD (#2783 / #2790)
 *
 *   GET /api/v1/reports/subscription — the caller's subscription + plan gate
 *   PUT /api/v1/reports/subscription — upsert cadence + covered hosts
 *
 * Owner-scoped via {@link resolveAlertRoutingOwnerId} (same convention as
 * alert-config): OSS single-tenant edits under owner `''` with zero auth,
 * cloud requires sign-in for writes. Plan gate (#2791): weekly cadence
 * requires a paid plan for cloud owners; monthly is available to everyone.
 * Delivery goes to the owner's configured alert channels — this route stores
 * only cadence + hosts, never recipients.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import { weeklyReportsAllowed } from '@/lib/insights/report-fanout'
import {
  getReportSubscription,
  isReportCadence,
  saveReportSubscription,
} from '@/lib/insights/report-subscription-store'

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

async function handleGet(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'read' },
    request
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveAlertRoutingOwnerId()
  const subscription = await getReportSubscription(ownerId)
  // OSS single-tenant is never plan-gated (fail-open, like lib/edition).
  const weeklyAllowed =
    ownerId === '' || weeklyReportsAllowed((await getPlanForOwner(ownerId)).id)

  return Response.json({
    success: true,
    subscription: subscription ?? {
      ownerId,
      cadence: 'off',
      hostIds: [0],
      lastSentAt: null,
      lastStatus: null,
    },
    weeklyAllowed,
  })
}

async function handlePut(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
    request
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to schedule reports.', 401)
  }

  let body: { cadence?: unknown; hostIds?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  if (!isReportCadence(body.cadence)) {
    return jsonError("cadence must be 'off', 'weekly', or 'monthly'", 400)
  }

  if (body.cadence === 'weekly' && ownerId !== '') {
    const plan = await getPlanForOwner(ownerId)
    if (!weeklyReportsAllowed(plan.id)) {
      return jsonError(
        'Weekly reports require a paid plan — the Free plan includes a monthly report.',
        403
      )
    }
  }

  // Validate host ids against the configured env hosts.
  const configured = new Set(
    getClickHouseConfigsFromEnv(env as Record<string, string | undefined>).map(
      (c) => c.id
    )
  )
  const hostIds = Array.isArray(body.hostIds)
    ? [
        ...new Set(
          body.hostIds
            .map((v) => Number.parseInt(String(v), 10))
            .filter((n) => Number.isInteger(n) && configured.has(n))
        ),
      ].sort((a, b) => a - b)
    : []
  if (body.cadence !== 'off' && hostIds.length === 0) {
    return jsonError('Select at least one configured host', 400)
  }

  const saved = await saveReportSubscription(ownerId, body.cadence, hostIds)
  if (!saved) {
    return jsonError('Persistence unavailable (no D1 configured)', 503)
  }

  return Response.json({ success: true })
}

export const Route = createFileRoute('/api/v1/reports/subscription')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      PUT: ({ request }) => handlePut(request),
    },
  },
})
