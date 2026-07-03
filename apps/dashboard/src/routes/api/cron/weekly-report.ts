/**
 * Weekly Health Report Cron Endpoint — GET /api/cron/weekly-report
 *
 * Invoked on a weekly schedule (see wrangler.toml `[triggers] crons`, and the
 * external-scheduler note in docs — like health-sweep and retention-prune, the
 * secret-gated GET is triggered by a scheduler that forwards `CRON_SECRET`).
 * For each host that has OPTED IN (via the `CHM_WEEKLY_REPORT_HOSTS`
 * comma-separated allowlist of host indices), it builds a per-host 7-day health
 * narrative from the insights engine + statistical baselines + capacity
 * forecast, PERSISTS it to the `weekly_reports` D1 store, and best-effort
 * delivers it via the configured outbound channel. Persistence happens
 * regardless of delivery (fail-open), so a deployment with no delivery channel
 * still accrues viewable reports (see GET /api/v1/insights/weekly-report).
 *
 * Opt-in, never opt-out: with `CHM_WEEKLY_REPORT_HOSTS` unset/empty NO reports
 * are generated, so self-hosted stays quiet by default.
 *
 * Guarded by a shared secret (CRON_SECRET) via the `Authorization: Bearer
 * <secret>` header or the `?secret=` query param — identical to health-sweep.
 * When CRON_SECRET is unset/empty this endpoint FAILS CLOSED with HTTP 503; the
 * platform routes scheduled events to the fetch handler as a plain GET with no
 * trusted in-request signal, so an unauthenticated caller must not be able to
 * trigger the sweep and its delivery fan-out.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, warn } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { secretsMatch } from '@/lib/auth/providers/constant-time'
import { getHost } from '@/lib/utils'
import {
  parseOptedInHosts,
  runWeeklyReportForHost,
} from '@/lib/insights/weekly-report'

/**
 * Authorize a cron request. Returns a short-circuit `Response` when the request
 * must be rejected, or `null` when it is authorized to proceed. Fail-closed:
 * without a configured CRON_SECRET this endpoint returns 503. Mirrors
 * health-sweep exactly.
 */
function authorizeCron(request: Request): Response | null {
  const bindings = env as Record<string, string | undefined>
  const secret = (bindings.CRON_SECRET ?? process.env.CRON_SECRET)?.trim()

  if (!secret) {
    warn(
      '[GET /api/cron/weekly-report] CRON_SECRET not configured — refusing (503). Set CRON_SECRET to enable this endpoint.'
    )
    return Response.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader && secretsMatch(authHeader, `Bearer ${secret}`)) return null

  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret')
  if (querySecret && secretsMatch(querySecret, secret)) return null

  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

async function handler(request: Request): Promise<Response> {
  const denied = authorizeCron(request)
  if (denied) return denied

  const bindings = env as Record<string, string | undefined>
  bridgeClickHouseEnv(bindings)

  try {
    const optedIn = parseOptedInHosts(
      bindings.CHM_WEEKLY_REPORT_HOSTS ?? process.env.CHM_WEEKLY_REPORT_HOSTS
    )

    // Resolve labels from the configured hosts; only report on opted-in indices
    // that actually correspond to a configured host.
    const configs = getClickHouseConfigsFromEnv(bindings)
    const byId = new Map(configs.map((c) => [c.id, c]))

    const results = []
    for (const hostId of optedIn) {
      const cfg = byId.get(hostId)
      if (!cfg) {
        warn(
          `[GET /api/cron/weekly-report] opted-in host ${hostId} has no configured ClickHouse host — skipping`
        )
        continue
      }
      const label = cfg.customName || getHost(cfg.host) || `Host ${hostId}`
      results.push(await runWeeklyReportForHost(hostId, label))
    }

    return Response.json(
      {
        optedInHosts: optedIn,
        reported: results.length,
        results,
      },
      { status: 200 }
    )
  } catch (err) {
    error(
      '[GET /api/cron/weekly-report] Weekly report run failed',
      err as Error
    )
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Weekly report run failed',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/cron/weekly-report')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
