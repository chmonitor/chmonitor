import type { Env } from './env'

import { licenseForProductId, makePlanForProductId } from './billing-deps'
import { licensePolarProductEnvKey } from '@chm/pricing'
import { describe, expect, test } from 'bun:test'

function stubEnv(overrides: Record<string, string> = {}): Env {
  return {
    CHM_POLAR_PRODUCT_FREE_MONTHLY: 'prod_free_m',
    CHM_POLAR_PRODUCT_PRO_MONTHLY: 'prod_pro_m',
    CHM_POLAR_PRODUCT_PRO_YEARLY: 'prod_pro_y',
    CHM_POLAR_PRODUCT_MAX_MONTHLY: 'prod_max_m',
    CHM_POLAR_PRODUCT_MAX_YEARLY: 'prod_max_y',
    CHM_POLAR_LICENSE_TEAM_YEARLY: 'prod_lic_team_y',
    CHM_POLAR_LICENSE_TEAM_LIFETIME: 'prod_lic_team_l',
    CHM_POLAR_LICENSE_UNLIMITED_YEARLY: 'prod_lic_unl_y',
    CHM_POLAR_LICENSE_UNLIMITED_LIFETIME: 'prod_lic_unl_l',
    ...overrides,
  }
}

describe('makePlanForProductId', () => {
  test('resolves each subscribable sku/term from exact env keys', () => {
    const planFor = makePlanForProductId(stubEnv())
    expect(planFor('prod_free_m')).toEqual({
      planId: 'free',
      period: 'monthly',
    })
    expect(planFor('prod_pro_y')).toEqual({ planId: 'pro', period: 'yearly' })
    expect(planFor('prod_max_m')).toEqual({ planId: 'max', period: 'monthly' })
  })

  test('honors free/monthly-only — yearly free env is ignored', () => {
    const planFor = makePlanForProductId(
      stubEnv({ CHM_POLAR_PRODUCT_FREE_YEARLY: 'prod_free_y_ignored' })
    )
    expect(planFor('prod_free_y_ignored')).toBeNull()
  })

  test('unknown product id → null; missing env → null-safe', () => {
    const planFor = makePlanForProductId(stubEnv())
    expect(planFor('prod_unknown')).toBeNull()
    expect(makePlanForProductId({})('prod_pro_m')).toBeNull()
  })

  test('env-key spelling matches CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>', () => {
    const env = stubEnv()
    expect(env.CHM_POLAR_PRODUCT_PRO_MONTHLY).toBe('prod_pro_m')
    expect(env.CHM_POLAR_PRODUCT_MAX_YEARLY).toBe('prod_max_y')
    expect(licensePolarProductEnvKey('team', 'yearly')).toBe(
      'CHM_POLAR_LICENSE_TEAM_YEARLY'
    )
  })
})

describe('licenseForProductId', () => {
  test('maps license Polar products and ignores seat-plan ids', () => {
    const env = stubEnv()
    expect(licenseForProductId(env, 'prod_lic_team_y')).toEqual({
      sku: 'team',
      term: 'yearly',
    })
    expect(licenseForProductId(env, 'prod_lic_unl_l')).toEqual({
      sku: 'unlimited',
      term: 'lifetime',
    })
    expect(licenseForProductId(env, 'prod_pro_m')).toBeNull()
    expect(licenseForProductId({}, 'prod_lic_team_y')).toBeNull()
  })
})
