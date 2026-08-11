/**
 * Cron triggers — guards a coupling that fails silently (issue #2900).
 *
 * `wrangler.toml` declares four `[triggers] crons`, but the deploy DROPS the
 * key: `scripts/patch-wrangler-env.ts` runs `delete generated.triggers` because
 * the account is over the Workers Free 5-crons-per-account budget, and ANY
 * schedules PUT (even `crons: []`) fails after a successful script upload and
 * exits the deploy 1 (see PRs #2866 / #2868). So the array is documentation of
 * the already-attached state, not a live setting.
 *
 * Two ways that goes wrong silently, both pinned here:
 *  1. Someone edits a cadence (say the 10-minute health sweep). The diff looks
 *     applied, review passes, the deploy is green — and production is
 *     unchanged. The array is pinned to the documented four cadences so such
 *     an edit has to be deliberate and has to update this test + the docs.
 *  2. Someone "cleans up" the strip in patch-wrangler-env.ts. The deploy then
 *     attempts a schedules PUT again and turns red the way #2868 did. The
 *     strip guard is pinned so removing it fails here first.
 *
 * Mirrors apps/cloud-hooks/src/cron.test.ts, which pins the same constraint
 * from the other side (that worker declares no crons at all).
 *
 * Re-enable path: the account must have cron budget again, THEN remove the
 * `delete generated.triggers` line (restoring the preview-only guard) and
 * update this test. See docs/knowledge/deployment.md § Cron triggers.
 */

import wranglerToml from '../wrangler.toml' with { type: 'toml' }
import { describe, expect, test } from 'bun:test'

/**
 * The cadences currently ATTACHED to the deployed `chmonitor-dash` worker.
 * Meanings (kept in wrangler.toml and docs/knowledge/deployment.md):
 *   "0 3 * * *"    → retention-prune, daily 03:00 UTC
 *   "0 8 * * 1"    → weekly-report, Mondays 08:00 UTC
 *   "0 8 1 * *"    → monthly-report, 1st of month 08:00 UTC
 *   "*\/10 * * * *" → health-sweep, every 10 minutes
 */
const DOCUMENTED_CRONS = [
  '0 3 * * *',
  '0 8 * * 1',
  '0 8 1 * *',
  '*/10 * * * *',
] as const

const toml = wranglerToml as {
  triggers?: { crons?: string[] }
  env?: { preview?: { triggers?: unknown } }
}

describe('dashboard cron triggers (INERT — see #2900)', () => {
  test('wrangler.toml crons match the documented attached cadences', () => {
    expect(toml.triggers?.crons).toEqual([...DOCUMENTED_CRONS])
  })

  test('preview env declares no triggers', () => {
    // Preview never had schedules; the cron HTTP routes work with CRON_SECRET.
    expect(toml.env?.preview?.triggers).toBeUndefined()
  })

  test('the deploy strips the triggers key — no schedules PUT', async () => {
    // Pinned on the source of scripts/patch-wrangler-env.ts rather than its
    // output: producing the output requires a full vite build and would
    // overwrite dist/server/wrangler.json. Both fail on the same event —
    // the strip guard being removed.
    const script = await Bun.file(
      new URL('./patch-wrangler-env.ts', import.meta.url)
    ).text()
    expect(script).toMatch(/^\s*delete generated\.triggers\s*$/m)
  })
})
