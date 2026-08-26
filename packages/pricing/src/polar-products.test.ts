import {
  planForProductIdFromLookup,
  SUBSCRIBABLE_PLAN_IDS,
  subscribablePlanProductEnvKey,
} from './polar-products'
import { describe, expect, test } from 'bun:test'

describe('subscribablePlanProductEnvKey', () => {
  test('matches dashboard and cloud-hooks key builders byte-for-byte', () => {
    expect(subscribablePlanProductEnvKey('free', 'monthly')).toBe(
      'CHM_POLAR_PRODUCT_FREE_MONTHLY'
    )
    expect(subscribablePlanProductEnvKey('pro', 'yearly')).toBe(
      'CHM_POLAR_PRODUCT_PRO_YEARLY'
    )
    expect(subscribablePlanProductEnvKey('max', 'monthly')).toBe(
      'CHM_POLAR_PRODUCT_MAX_MONTHLY'
    )
  })
})

describe('planForProductIdFromLookup', () => {
  const env: Record<string, string> = {
    CHM_POLAR_PRODUCT_FREE_MONTHLY: 'prod_free_m',
    CHM_POLAR_PRODUCT_PRO_MONTHLY: 'prod_pro_m',
    CHM_POLAR_PRODUCT_PRO_YEARLY: 'prod_pro_y',
    CHM_POLAR_PRODUCT_MAX_MONTHLY: 'prod_max_m',
    CHM_POLAR_PRODUCT_MAX_YEARLY: 'prod_max_y',
    CHM_POLAR_PRODUCT_FREE_YEARLY: 'prod_should_skip',
  }

  const lookup = (key: string) => env[key]

  test('maps pro/max monthly and yearly; free monthly only', () => {
    expect(planForProductIdFromLookup(lookup, 'prod_free_m')).toEqual({
      planId: 'free',
      period: 'monthly',
    })
    expect(planForProductIdFromLookup(lookup, 'prod_pro_y')).toEqual({
      planId: 'pro',
      period: 'yearly',
    })
    expect(planForProductIdFromLookup(lookup, 'prod_max_m')).toEqual({
      planId: 'max',
      period: 'monthly',
    })
  })

  test('skips free/yearly even when env is set', () => {
    expect(planForProductIdFromLookup(lookup, 'prod_should_skip')).toBeNull()
  })

  test('returns null for unknown product ids', () => {
    expect(planForProductIdFromLookup(lookup, 'prod_nope')).toBeNull()
    expect(planForProductIdFromLookup(() => undefined, 'prod_pro_m')).toBeNull()
  })

  test('SUBSCRIBABLE_PLAN_IDS is the canonical list', () => {
    expect(SUBSCRIBABLE_PLAN_IDS).toEqual(['free', 'pro', 'max'])
  })
})
