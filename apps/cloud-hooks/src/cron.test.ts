/**
 * Cron wiring — guards the one coupling that fails silently.
 *
 * Cloudflare hands `scheduled()` the cron string exactly as configured in
 * wrangler.toml, and index.ts routes on string equality. If someone edits a
 * schedule in wrangler.toml (or merely reformats one), the report it was meant
 * to trigger does not error — it quietly falls through to the ops-sweep branch
 * and is never sent again. Nothing else in the suite would notice, so
 * this test compares the two sources directly.
 */

import { DAILY_CRON, WEEKLY_CRON } from './index'
import { describe, expect, test } from 'bun:test'

/** The `crons = [...]` array from wrangler.toml, parsed without a TOML dep. */
async function configuredCrons(): Promise<string[]> {
  const toml = await Bun.file(
    new URL('../wrangler.toml', import.meta.url)
  ).text()
  const match = toml.match(/^crons\s*=\s*\[(.*?)\]/ms)
  if (!match) throw new Error('no `crons = [...]` found in wrangler.toml')
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

describe('cron triggers', () => {
  test('every schedule index.ts routes on is actually configured', async () => {
    const crons = await configuredCrons()
    expect(crons).toContain(DAILY_CRON)
    expect(crons).toContain(WEEKLY_CRON)
  })

  test('the weekly schedule is distinct from the daily one', () => {
    // Identical strings would make the first matching branch win and the other
    // report would never run.
    expect(WEEKLY_CRON).not.toBe(DAILY_CRON)
  })

  test('the ops sweep still has a schedule that falls through to it', async () => {
    const crons = await configuredCrons()
    const sweep = crons.filter((c) => c !== DAILY_CRON && c !== WEEKLY_CRON)
    // Probes, the exception scan, and the issue watch all hang off this branch.
    expect(sweep.length).toBeGreaterThan(0)
  })
})
