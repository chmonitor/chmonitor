/**
 * Tests for user-subscription.ts's `isSubscriptionLive` predicate — the core
 * of plan resolution (issue #2382, annual billing end-to-end).
 *
 * Annual subscriptions carry a `currentPeriodEnd` ~365 days out instead of the
 * usual ~30, but liveness is decided purely by `status` + `currentPeriodEnd` —
 * `billingPeriod` never gates access. These tests lock in that invariant so a
 * future change doesn't accidentally special-case yearly subscriptions (e.g.
 * treating them as always-live because the period "looks far away").
 *
 * user-subscription.ts statically imports subscription-store.ts →
 * @chm/platform → platform-native, which imports the virtual
 * `cloudflare:workers` module that only resolves under vite/workerd — stub it
 * the same way retention-owner.test.ts does. `isSubscriptionLive` itself is a
 * pure function so no D1/Polar mocking is needed beyond making the import
 * resolve.
 */

import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { isSubscriptionLive } = await import('./user-subscription')

const NOW = 1_800_000_000 // fixed reference instant

describe('isSubscriptionLive — annual billing intervals', () => {
  test('an active yearly subscription with currentPeriodEnd ~365 days out is live', () => {
    const yearFromNow = NOW + 365 * 24 * 60 * 60
    expect(
      isSubscriptionLive(
        { status: 'active', currentPeriodEnd: yearFromNow },
        NOW
      )
    ).toBe(true)
  })

  test('an active yearly subscription whose long period has actually lapsed is not live', () => {
    // The renewal webhook was missed and the ~365-day period ended in the past.
    const yearAgo = NOW - 365 * 24 * 60 * 60
    expect(
      isSubscriptionLive({ status: 'active', currentPeriodEnd: yearAgo }, NOW)
    ).toBe(false)
  })

  test('trialing counts as live regardless of how far currentPeriodEnd is', () => {
    const yearFromNow = NOW + 365 * 24 * 60 * 60
    expect(
      isSubscriptionLive(
        { status: 'trialing', currentPeriodEnd: yearFromNow },
        NOW
      )
    ).toBe(true)
  })

  test('a canceled yearly subscription is never live, even with time left in the period', () => {
    // Polar keeps a cancel-at-period-end sub as status "active" until the
    // period ends (see polar-subscription.ts) — a genuinely "canceled"
    // status here means access already ended.
    const yearFromNow = NOW + 365 * 24 * 60 * 60
    expect(
      isSubscriptionLive(
        { status: 'canceled', currentPeriodEnd: yearFromNow },
        NOW
      )
    ).toBe(false)
  })

  test('billingPeriod does not gate liveness — only status + currentPeriodEnd do', () => {
    // Same status/currentPeriodEnd inputs must resolve identically whether the
    // caller is thinking of the subscription as monthly or yearly, because
    // isSubscriptionLive never reads billingPeriod at all.
    const monthFromNow = NOW + 30 * 24 * 60 * 60
    const monthly = isSubscriptionLive(
      { status: 'active', currentPeriodEnd: monthFromNow },
      NOW
    )
    const yearly = isSubscriptionLive(
      { status: 'active', currentPeriodEnd: monthFromNow },
      NOW
    )
    expect(monthly).toBe(yearly)
    expect(monthly).toBe(true)
  })

  test('a null currentPeriodEnd (no expiry known) is live as long as status is live', () => {
    expect(
      isSubscriptionLive({ status: 'active', currentPeriodEnd: null }, NOW)
    ).toBe(true)
  })
})
