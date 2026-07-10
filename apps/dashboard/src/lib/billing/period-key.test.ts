/**
 * Tests for period-key.ts — the fix for issue #2514: monthly usage meters
 * (AI monthly USD budget, host-overage peak) must reset on the subscription's
 * billing cycle, not the calendar UTC month.
 *
 * `cycleStartKey` / `periodKeyFromSubscription` are pure and are the core of
 * the fix, so they get the bulk of the coverage here — especially the
 * short-month clamp (anchor day 29/30/31 landing in a shorter month) that a
 * naive `setUTCDate` implementation would roll over into the wrong month.
 *
 * `periodKeyForOwner` additionally resolves the subscription via D1
 * (`subscription-store.ts` → `@chm/platform` → the virtual `cloudflare:workers`
 * module, which only resolves under vite/workerd) — stub it like
 * retention-owner.test.ts so importing this module doesn't require a runtime.
 */

import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { cycleStartKey, periodKeyFromSubscription, utcMonthKey } = await import(
  './period-key'
)

describe('cycleStartKey', () => {
  test('mid-month anchor: cycle start is the anchor day this month once reached', () => {
    // Anchor day 15; `now` is the 20th of the same month → cycle already started this month.
    expect(cycleStartKey(15, new Date('2026-03-20T12:00:00Z'))).toBe(
      '2026-03-15'
    )
  })

  test('mid-month anchor: before the anchor day this month, cycle started last month', () => {
    // Anchor day 15; `now` is the 10th → still in the cycle that started Feb 15.
    expect(cycleStartKey(15, new Date('2026-03-10T00:00:00Z'))).toBe(
      '2026-02-15'
    )
  })

  test('exactly on the anchor day: the new cycle has just started (boundary is inclusive)', () => {
    expect(cycleStartKey(15, new Date('2026-03-15T00:00:00Z'))).toBe(
      '2026-03-15'
    )
  })

  test('anchor day 29 in February (non-leap year) clamps to the 28th', () => {
    // 2026 is not a leap year — February has 28 days.
    expect(cycleStartKey(29, new Date('2026-02-28T12:00:00Z'))).toBe(
      '2026-02-28'
    )
  })

  test('anchor day 29 in February (leap year) lands on the 29th', () => {
    expect(cycleStartKey(29, new Date('2028-02-29T12:00:00Z'))).toBe(
      '2028-02-29'
    )
  })

  test('anchor day 30 clamps to the 28th in February and rolls forward correctly in March', () => {
    // Before the (clamped) Feb anchor of the 28th.
    expect(cycleStartKey(30, new Date('2026-02-27T00:00:00Z'))).toBe(
      '2026-01-30'
    )
    // On/after the clamped Feb anchor.
    expect(cycleStartKey(30, new Date('2026-02-28T00:00:00Z'))).toBe(
      '2026-02-28'
    )
    // March has 31 days, so the real anchor day (30) is back in play.
    expect(cycleStartKey(30, new Date('2026-03-30T00:00:00Z'))).toBe(
      '2026-03-30'
    )
  })

  test('anchor day 31 clamps to the last day of 30-day months (April)', () => {
    expect(cycleStartKey(31, new Date('2026-04-25T00:00:00Z'))).toBe(
      '2026-03-31'
    )
    expect(cycleStartKey(31, new Date('2026-04-30T00:00:00Z'))).toBe(
      '2026-04-30'
    )
  })

  test('anchor day 31 in a 31-day month resolves to day 31 exactly', () => {
    expect(cycleStartKey(31, new Date('2026-01-31T00:00:00Z'))).toBe(
      '2026-01-31'
    )
  })

  test('year boundary: January anchor before the anchor day rolls back into December', () => {
    expect(cycleStartKey(20, new Date('2026-01-05T00:00:00Z'))).toBe(
      '2025-12-20'
    )
  })
})

describe('periodKeyFromSubscription', () => {
  test('no subscription (null) falls back to the calendar UTC month', () => {
    const now = new Date('2026-03-20T00:00:00Z')
    expect(periodKeyFromSubscription(null, now)).toBe(utcMonthKey(now))
  })

  test('undefined subscription falls back to the calendar UTC month', () => {
    const now = new Date('2026-03-20T00:00:00Z')
    expect(periodKeyFromSubscription(undefined, now)).toBe(utcMonthKey(now))
  })

  test('subscription with null currentPeriodEnd falls back to the calendar UTC month', () => {
    const now = new Date('2026-03-20T00:00:00Z')
    expect(periodKeyFromSubscription({ currentPeriodEnd: null }, now)).toBe(
      utcMonthKey(now)
    )
  })

  test('a live subscription keys off the cycle anchored to currentPeriodEnd, not the calendar month', () => {
    // currentPeriodEnd lands on the 15th of some future month — the anchor day.
    const currentPeriodEnd = Math.floor(
      new Date('2026-06-15T00:00:00Z').getTime() / 1000
    )
    const now = new Date('2026-03-20T00:00:00Z')
    // The current cycle for `now` started on the 15th of the current month
    // (March), not the calendar month key '2026-03'.
    expect(periodKeyFromSubscription({ currentPeriodEnd }, now)).toBe(
      'period:2026-03-15'
    )
    expect(periodKeyFromSubscription({ currentPeriodEnd }, now)).not.toBe(
      utcMonthKey(now)
    )
  })

  test('a mid-month cycle start does not zero the budget early: spend just before vs. after the boundary keys differently', () => {
    const currentPeriodEnd = Math.floor(
      new Date('2026-06-15T00:00:00Z').getTime() / 1000
    )
    const justBefore = new Date('2026-03-14T23:59:59Z')
    const justAfter = new Date('2026-03-15T00:00:00Z')
    expect(periodKeyFromSubscription({ currentPeriodEnd }, justBefore)).toBe(
      'period:2026-02-15'
    )
    expect(periodKeyFromSubscription({ currentPeriodEnd }, justAfter)).toBe(
      'period:2026-03-15'
    )
  })

  test('yearly plan: the monthly sub-window still keys off the day-of-month, not the yearly span', () => {
    // Yearly subscription renewing ~a year out, day-of-month 10.
    const currentPeriodEnd = Math.floor(
      new Date('2027-01-10T00:00:00Z').getTime() / 1000
    )
    expect(
      periodKeyFromSubscription(
        { currentPeriodEnd },
        new Date('2026-07-15T00:00:00Z')
      )
    ).toBe('period:2026-07-10')
    expect(
      periodKeyFromSubscription(
        { currentPeriodEnd },
        new Date('2026-08-05T00:00:00Z')
      )
    ).toBe('period:2026-07-10')
    expect(
      periodKeyFromSubscription(
        { currentPeriodEnd },
        new Date('2026-08-10T00:00:00Z')
      )
    ).toBe('period:2026-08-10')
  })
})

describe('utcMonthKey (OSS/free fallback, unchanged)', () => {
  test('returns YYYY-MM regardless of day-of-month', () => {
    expect(utcMonthKey(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07')
    expect(utcMonthKey(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07')
  })
})
