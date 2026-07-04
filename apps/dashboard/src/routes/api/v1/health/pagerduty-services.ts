/**
 * PagerDuty service picker helper (plans/34-pagerduty-escalation-oncall.md).
 *
 *   GET /api/v1/health/pagerduty-services — list PagerDuty services via the
 *   account-level REST API token (`HEALTH_ALERT_PAGERDUTY_API_KEY`), for the
 *   alert-routing setup dialog's picker.
 *
 * READ-ONLY: this never calls a PagerDuty write/mutation endpoint — creating
 * services/escalation policies/schedules stays the operator's job in
 * PagerDuty itself (see `lib/health/pagerduty-config.ts`). Best-effort: an
 * unset/invalid token or any PagerDuty API error resolves to an empty list
 * rather than a 5xx, so the dialog can always fall back to pasting a routing
 * key by hand.
 *
 * Gated like alert-routing writes (`requiresSignInForWrite`) rather than the
 * routes GET: listing services reveals the operator's PagerDuty account
 * structure, so cloud mode requires sign-in; self-hosted (no Clerk) stays
 * open with zero auth, per "self-hosted stays whole".
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import { listPagerDutyServices } from '@/lib/health/pagerduty-config'

async function handleGet(): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return Response.json(
      {
        success: false,
        error: { message: 'Sign in to list PagerDuty services.' },
      },
      { status: 401 }
    )
  }

  const services = await listPagerDutyServices()
  return Response.json({ success: true, services }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/pagerduty-services')({
  server: {
    handlers: {
      GET: async () => handleGet(),
    },
  },
})
