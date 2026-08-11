/**
 * Cron wiring — guards the one coupling that fails silently.
 *
 * The Worker now runs on a SINGLE cron trigger (the Workers Free plan caps
 * cron triggers at 5 per account; the dashboard uses 4). Cloudflare hands
 * `scheduled()` the raw configured string, and the daily digest / weekly
 * report are dispatched off the tick's `scheduledTime` instead of separate
 * cron expressions. If wrangler.toml drifts from OPS_SWEEP_CRON, or the tick
 * classifiers stop matching the times the sweep actually fires at, a report
 * quietly never runs again — nothing errors. So this test compares the two
 * sources directly and pins the classifier behavior.
 */

import { isDailyTick, isWeeklyTick, OPS_SWEEP_CRON } from './index'
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
  test('the single configured schedule is exactly OPS_SWEEP_CRON', async () => {
    // More than one schedule would blow the 5-per-account free-plan budget
    // (dashboard 4 + hooks 1) and break the dashboard's own deploy.
    expect(await configuredCrons()).toEqual([OPS_SWEEP_CRON])
  })

  test('the sweep cadence actually produces the report ticks', () => {
    // A */15 cron fires at minute 0, so both report ticks exist on the
    // schedule. If OPS_SWEEP_CRON ever changes to a cadence that skips
    // minute 0 (e.g. "7/15"), the reports silently die.
    expect(OPS_SWEEP_CRON).toBe('*/15 * * * *')
  })

  test('daily tick matches only 00:00 UTC', () => {
    expect(isDailyTick(new Date('2026-08-11T00:00:00Z'))).toBe(true)
    expect(isDailyTick(new Date('2026-08-11T00:15:00Z'))).toBe(false)
    expect(isDailyTick(new Date('2026-08-11T12:00:00Z'))).toBe(false)
  })

  test('weekly tick matches only Monday 01:00 UTC', () => {
    // 2026-08-10 is a Monday.
    expect(isWeeklyTick(new Date('2026-08-10T01:00:00Z'))).toBe(true)
    expect(isWeeklyTick(new Date('2026-08-11T01:00:00Z'))).toBe(false) // Tuesday
    expect(isWeeklyTick(new Date('2026-08-10T01:15:00Z'))).toBe(false)
    expect(isWeeklyTick(new Date('2026-08-10T00:00:00Z'))).toBe(false)
  })

  test('the daily and weekly ticks never coincide', () => {
    // Monday 00:00 runs the daily digest; Monday 01:00 runs the weekly
    // report. The scheduled() dispatch runs at most one report per tick.
    expect(isDailyTick(new Date('2026-08-10T01:00:00Z'))).toBe(false)
    expect(isWeeklyTick(new Date('2026-08-10T00:00:00Z'))).toBe(false)
  })
})
