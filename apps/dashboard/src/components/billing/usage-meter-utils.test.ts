import {
  deferredNote,
  formatUsd,
  type Meter,
  meterLevel,
  meterPercent,
  renewalBannerState,
} from './usage-meter-utils'
import { describe, expect, test } from 'bun:test'

const meter = (used: number, limit: number | null): Meter => ({
  used,
  limit,
  unlimited: limit == null,
})

describe('meterLevel — the paywall threshold (red past 80%)', () => {
  test('normal below 60% of the cap', () => {
    expect(meterLevel(meter(0, 1))).toBe('normal') // Free hosts, none used
    expect(meterLevel(meter(1, 3))).toBe('normal') // 33%
    expect(meterLevel(meter(59, 100))).toBe('normal')
  })

  test('amber from 60% up to (not including) 80%', () => {
    expect(meterLevel(meter(60, 100))).toBe('amber')
    expect(meterLevel(meter(2, 3))).toBe('amber') // 66%
    expect(meterLevel(meter(79, 100))).toBe('amber')
  })

  test('red at or past 80% — including at/over the limit', () => {
    expect(meterLevel(meter(80, 100))).toBe('red')
    expect(meterLevel(meter(3, 3))).toBe('red') // at limit
    expect(meterLevel(meter(5, 3))).toBe('red') // over limit
  })

  test('unlimited / uncapped meters never colour', () => {
    expect(meterLevel(meter(9999, null))).toBe('normal') // Enterprise
    expect(meterLevel({ used: 5, limit: 0, unlimited: false })).toBe('normal')
  })

  test('a store hiccup (NaN / negative used) degrades to normal, never over-limit', () => {
    expect(meterLevel(meter(Number.NaN, 3))).toBe('normal')
    expect(meterLevel(meter(-4, 3))).toBe('normal')
  })
})

describe('meterPercent — bar fill', () => {
  test('rounds the ratio and clamps to 100', () => {
    expect(meterPercent(meter(1, 3))).toBe(33)
    expect(meterPercent(meter(3, 3))).toBe(100)
    expect(meterPercent(meter(9, 3))).toBe(100) // over-limit clamps
  })

  test('is 0 for unlimited / uncapped', () => {
    expect(meterPercent(meter(50, null))).toBe(0)
    expect(meterPercent({ used: 5, limit: 0, unlimited: false })).toBe(0)
  })
})

describe('formatUsd — the AI monthly-spend meter', () => {
  test('always two decimals', () => {
    expect(formatUsd(0)).toBe('$0.00') // Free: $0.00 / $0.50
    expect(formatUsd(0.5)).toBe('$0.50')
    expect(formatUsd(5)).toBe('$5.00')
    expect(formatUsd(12.34)).toBe('$12.34')
  })

  test('non-finite spend degrades to $0.00 rather than "NaN"', () => {
    expect(formatUsd(Number.NaN)).toBe('$0.00')
  })
})

describe('deferredNote — honest paywalls (advertised ⟺ enforced)', () => {
  test('enforced limits read as real caps (no note)', () => {
    // hosts / seats / AI daily / AI monthly-USD are all live gates today.
    expect(deferredNote('hosts')).toBeNull()
    expect(deferredNote('seats')).toBeNull()
    expect(deferredNote('aiRequestsPerDay')).toBeNull()
    expect(deferredNote('aiMonthlyUsdBudget')).toBeNull()
  })

  test('a deferred limit is labelled informational, not "upgrade to unlock"', () => {
    // alertRules has no create-path yet → deferred → must be flagged.
    expect(deferredNote('alertRules')).toBe('not billed in early access')
  })
})

describe('renewalBannerState — Pro renewal + cancel-grace', () => {
  test('Free / never subscribed shows nothing', () => {
    expect(
      renewalBannerState({
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        status: 'none',
      })
    ).toBe('hidden')
  })

  test('active paid subscription shows the renewal date', () => {
    expect(
      renewalBannerState({
        currentPeriodEnd: 1_800_000_000,
        cancelAtPeriodEnd: false,
        status: 'active',
      })
    ).toBe('renew')
  })

  test('cancel-at-period-end shows the grace banner', () => {
    expect(
      renewalBannerState({
        currentPeriodEnd: 1_800_000_000,
        cancelAtPeriodEnd: true,
        status: 'active',
      })
    ).toBe('cancel')
  })
})
