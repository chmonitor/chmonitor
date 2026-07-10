/**
 * Tests for polar-config.ts's product↔plan mapping — the bridge between a
 * Polar checkout (productId) and our internal plan/period. A stale or
 * misconfigured CHM_POLAR_PRODUCT_<PLAN>_<PERIOD> env var here grants the
 * wrong plan after checkout, silently — no error, just wrong entitlements
 * (issue #2493).
 *
 * `productIdFor` / `planForProductId` read directly from `process.env` via
 * the module's private `readEnv()`, so tests just set/restore the relevant
 * env vars around each test — same convention as lib/auth/provider.test.ts.
 * No module mocking needed: polar-config.ts's only runtime import is
 * `@polar-sh/sdk`, used lazily by `getPolarClient()`, which these tests never
 * call.
 */

import type { BillingPeriod, PaidPlanId } from './polar-config'

import { PAID_PLAN_IDS, planForProductId, productIdFor } from './polar-config'
import { afterEach, describe, expect, test } from 'bun:test'

const PERIODS: readonly BillingPeriod[] = ['monthly', 'yearly']

function envKey(planId: PaidPlanId, period: BillingPeriod): string {
  return `CHM_POLAR_PRODUCT_${planId.toUpperCase()}_${period.toUpperCase()}`
}

const ALL_ENV_KEYS = PAID_PLAN_IDS.flatMap((planId) =>
  PERIODS.map((period) => envKey(planId, period))
)
const originalEnv = new Map(ALL_ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ALL_ENV_KEYS) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

describe('productIdFor / planForProductId — round trip', () => {
  const cases = PAID_PLAN_IDS.flatMap((planId) =>
    PERIODS.map((period) => [planId, period] as const)
  )

  test.each(
    cases
  )('%s/%s: planForProductId(productIdFor(plan, period)) round-trips to {plan, period}', (planId, period) => {
    process.env[envKey(planId, period)] = `prod_${planId}_${period}_test`

    const productId = productIdFor(planId, period)
    expect(productId).toBe(`prod_${planId}_${period}_test`)
    // The reverse map must recover exactly the plan/period that produced
    // the id — this is the checkout→entitlement bridge; if it silently
    // drifted, checkout would grant the wrong plan.
    expect(planForProductId(productId as string)).toEqual({
      planId,
      period,
    })
  })
})

describe('productIdFor — unconfigured env', () => {
  test('an unset CHM_POLAR_PRODUCT_* var resolves to null', () => {
    delete process.env[envKey('pro', 'monthly')]
    expect(productIdFor('pro', 'monthly')).toBeNull()
  })

  test('an empty-string env var resolves to null (readEnv treats "" as unset)', () => {
    process.env[envKey('pro', 'monthly')] = ''
    expect(productIdFor('pro', 'monthly')).toBeNull()
  })
})

describe('planForProductId — unmapped product id', () => {
  test('a product id that matches no configured plan/period returns null', () => {
    for (const planId of PAID_PLAN_IDS) {
      for (const period of PERIODS) {
        process.env[envKey(planId, period)] = `prod_${planId}_${period}`
      }
    }

    expect(planForProductId('prod_totally_unrelated')).toBeNull()
  })

  test('with every product id unset, an empty product id still never matches', () => {
    // Guards against a naive implementation where every unconfigured slot
    // resolving to the same "empty" sentinel could false-positive-match an
    // equally empty productId argument.
    for (const key of ALL_ENV_KEYS) delete process.env[key]

    expect(planForProductId('')).toBeNull()
  })
})
