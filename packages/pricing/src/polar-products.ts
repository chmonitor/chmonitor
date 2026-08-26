/**
 * Polar subscribable-plan product env keys + reverse map.
 *
 * Runtime-agnostic: callers pass a lookup fn (process.env or Worker Env).
 * License-side keys live in `licenses.ts`.
 */

import type { PlanId } from './plans'

export const SUBSCRIBABLE_PLAN_IDS = ['free', 'pro', 'max'] as const
export type SubscribablePlanId = (typeof SUBSCRIBABLE_PLAN_IDS)[number]
export type BillingPeriod = 'monthly' | 'yearly'

export function subscribablePlanProductEnvKey(
  planId: SubscribablePlanId,
  period: BillingPeriod
): string {
  return `CHM_POLAR_PRODUCT_${planId.toUpperCase()}_${period.toUpperCase()}`
}

/** Reverse map: Polar product id → plan + period, or null when unmapped. */
export function planForProductIdFromLookup(
  lookup: (key: string) => string | undefined,
  productId: string
): { planId: SubscribablePlanId; period: BillingPeriod } | null {
  for (const planId of SUBSCRIBABLE_PLAN_IDS) {
    for (const period of ['monthly', 'yearly'] as const) {
      if (planId === 'free' && period === 'yearly') continue
      const key = subscribablePlanProductEnvKey(planId, period)
      if (lookup(key) === productId) return { planId, period }
    }
  }
  return null
}

/** Type guard: subscribable plan ids are a subset of PlanId. */
export function isSubscribablePlanId(
  value: string
): value is SubscribablePlanId {
  return (SUBSCRIBABLE_PLAN_IDS as readonly string[]).includes(value)
}

export type { PlanId }
