/**
 * Health-sweep cron enablement gate.
 *
 * The autonomous health-sweep (`GET /api/cron/health-sweep`, wired to the
 * Cloudflare Cron trigger in `wrangler.toml`) runs the health/anomaly sweep and
 * fans out webhook alerts with NO dashboard tab open. Scheduling it means it
 * fires unattended, so operators need a single switch to turn the *scheduled*
 * run on/off independently of the CRON_SECRET auth gate.
 *
 * `isHealthSweepEnabled` is that switch:
 *   - `CHM_HEALTH_SWEEP_ENABLED` set to a truthy value  → enabled
 *   - `CHM_HEALTH_SWEEP_ENABLED` set to a falsy value    → disabled (opt-out)
 *   - unset / junk → DEFAULT: enabled only when `CRON_SECRET` is configured,
 *     disabled otherwise. Fail-closed, mirroring `lib/cloud` / `lib/edition`:
 *     a self-hoster who never set up cron auth never runs the sweep on a
 *     schedule by accident.
 *
 * Pure — pass any env getter (Worker binding, `process.env`, or a mock).
 */

import { parseBool } from '@/lib/config/parse-bool'

export type EnvGetter = (key: string) => string | undefined

/**
 * Whether the scheduled health-sweep is allowed to RUN. See module docstring
 * for the resolution order.
 */
export function isHealthSweepEnabled(getEnv: EnvGetter): boolean {
  const explicit = parseBool(getEnv('CHM_HEALTH_SWEEP_ENABLED'))
  if (explicit !== undefined) return explicit

  // Default: fail-closed to the CRON_SECRET posture. If cron auth is configured
  // the operator clearly runs cron jobs, so the sweep runs; otherwise it does
  // not (and the route also 503s on the missing secret anyway).
  return Boolean(getEnv('CRON_SECRET')?.trim())
}
