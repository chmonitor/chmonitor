/**
 * Tests for user-subscription.ts's plan-resolution contract:
 * `isSubscriptionLive` (status allowlist + expiry boundary) and
 * `getPlanIdForOwner` (issue #2382 annual billing end-to-end; issue #2493
 * closes the coverage gap on the boundary + owner-resolution layer — the
 * paid-vs-free decision itself had zero coverage before this).
 *
 * Annual subscriptions carry a `currentPeriodEnd` ~365 days out instead of the
 * usual ~30, but liveness is decided purely by `status` + `currentPeriodEnd` —
 * `billingPeriod` never gates access. These tests lock in that invariant so a
 * future change doesn't accidentally special-case yearly subscriptions (e.g.
 * treating them as always-live because the period "looks far away").
 *
 * The expiry boundary is a strict `<`: a subscription whose `currentPeriodEnd`
 * equals `nowSeconds` is still live for that instant. If that comparison ever
 * flips to `<=`, a paying customer loses access one second early — the
 * "expiry boundary" describe block below exists to catch exactly that
 * regression.
 *
 * user-subscription.ts statically imports subscription-store.ts →
 * @chm/platform → platform-native, which imports the virtual
 * `cloudflare:workers` module that only resolves under vite/workerd — stub it
 * the same way retention-owner.test.ts does. `isSubscriptionLive` itself is a
 * pure function so no D1/Polar mocking is needed for it beyond making the
 * import resolve. `getPlanIdForOwner` DOES call through to the store/Polar
 * reconciliation, so it additionally mocks `./subscription-store` and
 * `./polar-subscription` with their FULL real export surface (not just what
 * this file needs): bun's mock.module() registers per resolved specifier, and
 * routes/api/v1/webhooks/polar.test.ts also mocks these same two modules (via
 * the `@/` alias, which resolves to the same files) with a different, smaller
 * export subset. Both files can run in one `bun test` process, so an
 * incomplete mock here risks "export not found" if the OTHER file's factory
 * wins the registration race — mirrors the documented pattern in
 * polar-subscription.test.ts for polar-config.ts.
 */

import type { PlanId } from './plans'
import type { OwnerSubscription } from './polar-subscription'
import type {
  UpsertSubscriptionInput,
  UserSubscription,
} from './subscription-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let getSubscriptionImpl = mock(
  async (_ownerId: string): Promise<UserSubscription | null> => null
)
let upsertSubscriptionImpl = mock(
  async (_input: UpsertSubscriptionInput): Promise<void> => {}
)
mock.module('./subscription-store', () => ({
  getSubscription: (ownerId: string) => getSubscriptionImpl(ownerId),
  upsertSubscription: (input: UpsertSubscriptionInput) =>
    upsertSubscriptionImpl(input),
}))

let pullOwnerSubscriptionFromPolarImpl = mock(
  async (_externalId: string): Promise<OwnerSubscription | null> => null
)
mock.module('./polar-subscription', () => ({
  pullOwnerSubscriptionFromPolar: (externalId: string) =>
    pullOwnerSubscriptionFromPolarImpl(externalId),
  invalidateNegativeCache: (_externalId: string) => {},
  __resetPolarSubscriptionCacheForTests: () => {},
}))

const { isSubscriptionLive, getPlanIdForOwner } = await import(
  './user-subscription'
)

const NOW = 1_800_000_000 // fixed reference instant

/** A realistic D1-cached row; override only the fields a test cares about. */
function fakeCachedSubscription(
  overrides: Partial<UserSubscription> = {}
): UserSubscription {
  return {
    userId: 'user_fixture',
    ownerType: 'user',
    planId: 'pro',
    billingPeriod: 'monthly',
    status: 'active',
    polarSubscriptionId: 'sub_fixture',
    polarCustomerId: 'cus_fixture',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

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

describe('isSubscriptionLive — status allowlist (LIVE vs DEAD statuses)', () => {
  // Same unexpired currentPeriodEnd for every case so only `status` varies —
  // isolates the allowlist check from the expiry boundary (covered below).
  const unexpired = NOW + 30 * 24 * 60 * 60

  test.each([
    ['active', true],
    ['trialing', true],
    ['canceled', false],
    ['past_due', false],
    ['revoked', false],
    // An unrecognized status must fail closed (not live), not fail open.
    ['some_unrecognized_polar_status', false],
  ] as const)('status "%s" with an unexpired period → live=%s', (status, expected) => {
    expect(
      isSubscriptionLive({ status, currentPeriodEnd: unexpired }, NOW)
    ).toBe(expected)
  })
})

describe('isSubscriptionLive — expiry boundary (strict less-than contract)', () => {
  // The contract is `currentPeriodEnd < nowSeconds` ⇒ expired — strict, not
  // `<=`. If someone "simplifies" that to `<=`, a subscription expiring at
  // exactly `now` loses access one instant early; this table exists to fail
  // loudly the moment that happens.
  test.each([
    [
      'currentPeriodEnd === nowSeconds (the boundary instant itself)',
      NOW,
      true,
    ],
    ['currentPeriodEnd one second before nowSeconds', NOW - 1, false],
    ['currentPeriodEnd is null (no expiry tracked)', null, true],
  ] as const)('%s → live=%s', (_label, currentPeriodEnd, expected) => {
    expect(
      isSubscriptionLive({ status: 'active', currentPeriodEnd }, NOW)
    ).toBe(expected)
  })
})

describe('getPlanIdForOwner', () => {
  beforeEach(() => {
    // Default: no D1 row, no Polar customer — the common free-user case.
    // Individual tests override one or both to exercise the other paths.
    getSubscriptionImpl = mock(async () => null)
    upsertSubscriptionImpl = mock(async () => {})
    pullOwnerSubscriptionFromPolarImpl = mock(async () => null)
  })

  test('no subscription anywhere (D1 empty, Polar has no customer) resolves to free', async () => {
    expect(await getPlanIdForOwner('user_none')).toBe('free')
  })

  test('a live cached subscription resolves to its own plan, not free', async () => {
    getSubscriptionImpl = mock(async () =>
      fakeCachedSubscription({ planId: 'max' })
    )

    expect(await getPlanIdForOwner('user_max')).toBe('max')
  })

  test('a dead cached subscription — and Polar confirms nothing live — resolves to free', async () => {
    getSubscriptionImpl = mock(async () =>
      fakeCachedSubscription({ status: 'canceled', planId: 'pro' })
    )
    pullOwnerSubscriptionFromPolarImpl = mock(async () => null)

    expect(await getPlanIdForOwner('user_lapsed')).toBe('free')
  })

  test('an unknown/retired planId on an otherwise-live row falls back to free via validPlanId', async () => {
    // Simulates a D1 row written before a plan was renamed or retired — D1
    // data isn't compile-time checked, so validPlanId() is the runtime guard
    // against exactly this. The cast is deliberate: PlanId's real union can't
    // express an invalid id, which is the scenario under test.
    getSubscriptionImpl = mock(async () =>
      fakeCachedSubscription({ planId: 'legacy_tier_x' as PlanId })
    )

    expect(await getPlanIdForOwner('user_legacy')).toBe('free')
  })
})
