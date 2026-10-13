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

describe('cron triggers', () => {
  test('wrangler.toml declares NO crons — schedules PUT must be skipped', async () => {
    // The account is over the Workers Free 5-crons-per-account budget, so ANY
    // schedules PUT (even `crons = []`) fails after a successful upload and
    // turns the deploy red. Wrangler only skips the schedules API when the
    // key is absent. Re-adding a `crons = [...]` line reintroduces the CI
    // failure — see the wrangler.toml note.
    const toml = await Bun.file(
      new URL('../wrangler.toml', import.meta.url)
    ).text()
    expect(toml).not.toMatch(/^\s*crons\s*=/m)
  })

  test('the sweep cadence actually produces the report ticks', () => {
    // A */15 cron fires at minutes 0 and 30, so both report ticks (daily 00:30,
    // weekly 01:00) exist on the schedule. If OPS_SWEEP_CRON ever changes to a
    // cadence that skips them (e.g. "7/15"), the reports silently die.
    expect(OPS_SWEEP_CRON).toBe('*/15 * * * *')
  })

  test('daily tick matches only 00:30 UTC', () => {
    expect(isDailyTick(new Date('2026-08-11T00:30:00Z'))).toBe(true)
    expect(isDailyTick(new Date('2026-08-11T00:15:00Z'))).toBe(false)
    expect(isDailyTick(new Date('2026-08-11T12:30:00Z'))).toBe(false)
  })

  // The telemetry service writes yesterday's totals in its rollup at 00:10 UTC
  // and reports zeros until then. A digest or anomaly check before that point
  // would show DAU 0 and alert "100% drop" every day.
  test('the daily tick is after the telemetry rollup (00:10 UTC)', () => {
    const rollupMinute = 10
    const at = new Date('2026-08-11T00:00:00Z')
    for (let min = 0; min < 60; min += 15) {
      at.setUTCMinutes(min)
      if (isDailyTick(at)) expect(min).toBeGreaterThan(rollupMinute)
    }
  })

  test('weekly tick matches only Monday 01:00 UTC', () => {
    // 2026-08-10 is a Monday.
    expect(isWeeklyTick(new Date('2026-08-10T01:00:00Z'))).toBe(true)
    expect(isWeeklyTick(new Date('2026-08-11T01:00:00Z'))).toBe(false) // Tuesday
    expect(isWeeklyTick(new Date('2026-08-10T01:15:00Z'))).toBe(false)
    expect(isWeeklyTick(new Date('2026-08-10T00:00:00Z'))).toBe(false)
  })

  test('the daily and weekly ticks never coincide', () => {
    // Monday 00:30 runs the daily digest; Monday 01:00 runs the weekly
    // report. The scheduled() dispatch runs at most one report per tick.
    expect(isDailyTick(new Date('2026-08-10T01:00:00Z'))).toBe(false)
    expect(isWeeklyTick(new Date('2026-08-10T00:30:00Z'))).toBe(false)
  })
})
