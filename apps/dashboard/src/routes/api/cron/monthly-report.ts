/**
 * Monthly Health Report Cron Endpoint — GET /api/cron/monthly-report (#2785)
 *
 * Sibling of /api/cron/weekly-report on a monthly schedule ("0 8 1 * *", see
 * wrangler.toml `[triggers] crons` — like every cron route, the secret-gated
 * GET is triggered by an external scheduler forwarding `CRON_SECRET`).
 *
 * Reuses the exact weekly pipeline over a 30-day window: per-owner
 * `report_subscriptions` with cadence 'monthly' are built, persisted, and
 * delivered to each owner's configured alert channels. Monthly is the Free
 * tier's cadence, so there is no plan gate here. There is no monthly env
 * opt-in equivalent of CHM_WEEKLY_REPORT_HOSTS — subscriptions are the only
 * monthly trigger (OSS single-tenant subscribes via /report-settings).
 *
 * Fails closed without CRON_SECRET (503) — identical auth to weekly-report.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, warn } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeCronRequest } from '@/lib/cron/authorize-cron'
import { runReportFanout } from '@/lib/insights/report-fanout'

async function handler(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request, 'monthly-report')
  if (denied) {
    if (denied.status === 503) {
      warn(
        '[GET /api/cron/monthly-report] CRON_SECRET not configured — refusing (503). Set CRON_SECRET to enable this endpoint.'
      )
    }
    return denied
  }

  const bindings = env as Record<string, string | undefined>
  bridgeClickHouseEnv(bindings)

  try {
    const fanout = await runReportFanout('monthly', bindings)
    return Response.json(
      { subscriptions: fanout.length, fanout },
      { status: 200 }
    )
  } catch (err) {
    error(
      '[GET /api/cron/monthly-report] Monthly report run failed',
      err as Error
    )
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Monthly report run failed',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/cron/monthly-report')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
