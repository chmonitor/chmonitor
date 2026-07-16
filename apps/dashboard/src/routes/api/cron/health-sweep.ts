/**
 * Autonomous Health Sweep Cron Endpoint — GET /api/cron/health-sweep
 *
 * Invoked by the Cloudflare Cron Trigger (see wrangler.toml `[triggers] crons`)
 * every 10 minutes. The @cloudflare/vite-plugin worker routes scheduled events
 * to the fetch handler, so the cron hits this GET route. Runs the health/anomaly
 * sweep over all hosts and dispatches webhook alerts for findings at/above the
 * configured severity.
 *
 * Two gates apply, in order: (1) CRON_SECRET auth (below), then (2) the
 * CHM_HEALTH_SWEEP_ENABLED enablement switch (see lib/health/sweep-schedule.ts)
 * — a falsy value makes the scheduled run a 200 no-op without removing the cron.
 *
 * Guarded by a shared secret (CRON_SECRET) supplied via the `Authorization:
 * Bearer <secret>` header or the `?secret=` query param. Returns 401 on
 * mismatch.
 *
 * CRON_SECRET is REQUIRED for this route: when it is unset/empty the endpoint
 * FAILS CLOSED with HTTP 503 (it does NOT run). The platform routes Cloudflare
 * scheduled events to the fetch handler as a plain GET with no distinguishable,
 * trusted in-request signal, so there is no safe "internal cron only" path — an
 * unauthenticated caller would otherwise trigger the sweep and its webhook
 * fan-out. Operators MUST configure CRON_SECRET and pass it from their scheduler
 * (see docs).
 *
 * Ported from apps/dashboard/app/api/cron/health-sweep/route.ts (Next.js).
 * Differences from the Next version:
 *   - The handler is wired through TanStack Start `createFileRoute().server`.
 *   - CRON_SECRET is read from the Worker `env` binding (authoritative on
 *     workerd) with a `process.env` fallback for node/dev.
 *   - `bridgeClickHouseEnv(env)` copies CLICKHOUSE_* from the Worker binding
 *     onto `process.env` before the sweep, because `getClickHouseConfigs()`
 *     (used by `runHealthSweep`) reads host config from `process.env`.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error, warn } from '@chm/logger'
import { bridgeClickHouseEnv, bridgePostgresEnv } from '@/lib/api/server-env'
import { secretsMatch } from '@/lib/auth/providers/constant-time'
import { runHealthSweep } from '@/lib/health/server-sweep'
import { isHealthSweepEnabled } from '@/lib/health/sweep-schedule'

/**
 * Authorize a cron request. Returns a short-circuit `Response` when the request
 * must be rejected, or `null` when it is authorized to proceed.
 *
 * Fail-closed: when CRON_SECRET is unset/empty we return 503 (not configured)
 * instead of allowing the request through.
 */
function authorizeCron(request: Request): Response | null {
  const bindings = env as Record<string, string | undefined>
  const secret = (bindings.CRON_SECRET ?? process.env.CRON_SECRET)?.trim()

  // Fail closed: without a configured secret this endpoint is disabled rather
  // than left open to unauthenticated callers (which could trigger the sweep
  // and its webhook fan-out).
  if (!secret) {
    warn(
      '[GET /api/cron/health-sweep] CRON_SECRET not configured — refusing (503). Set CRON_SECRET to enable this endpoint.'
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

  // Scheduled-run enablement gate (issue #2666). The `*/10 * * * *` Cloudflare
  // Cron trigger fires this route unattended, so operators get a single switch
  // (CHM_HEALTH_SWEEP_ENABLED) to disable the *scheduled* sweep without removing
  // the cron or the secret. Reads the Worker binding first (authoritative on
  // workerd), then process.env (node/dev). Default when unset: enabled because
  // we are already past the CRON_SECRET auth gate above. Returns 200 (a no-op
  // success, not an error) so the scheduler treats a disabled sweep as "ran
  // fine, nothing to do".
  const bindings = env as Record<string, string | undefined>
  if (
    !isHealthSweepEnabled(
      (key) => bindings[key] ?? process.env[key] ?? undefined
    )
  ) {
    return Response.json(
      { skipped: true, reason: 'CHM_HEALTH_SWEEP_ENABLED is falsy' },
      { status: 200 }
    )
  }

  // Copy CLICKHOUSE_* from the Worker binding onto process.env so
  // getClickHouseConfigs() (inside runHealthSweep) can resolve hosts. Also
  // bridge the POSTGRES_* lists + feature flag so the sweep's env-gated Postgres
  // insight loop can resolve its sources.
  bridgeClickHouseEnv(env as Record<string, string | undefined>)
  bridgePostgresEnv(env as Record<string, string | undefined>)

  try {
    const summary = await runHealthSweep()
    return Response.json(summary, { status: 200 })
  } catch (err) {
    error('[GET /api/cron/health-sweep] Sweep failed', err as Error)
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Health sweep failed',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/cron/health-sweep')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})

export { handler as __handlerForTests }
