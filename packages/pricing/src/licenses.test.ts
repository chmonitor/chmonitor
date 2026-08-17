import {
  getLicense,
  isPaidLicense,
  LICENSE_SKU_LIST,
  licenseHostsLabel,
  licensePolarPriceCents,
  licensePolarProductEnvKey,
  licensePolarProductName,
  licensePriceUsd,
  lifetimeMultiple,
} from './licenses'
import { describe, expect, test } from 'bun:test'

describe('self-hosted licenses', () => {
  test('only personal, team, unlimited', () => {
    expect(LICENSE_SKU_LIST.map((s) => s.id)).toEqual([
      'personal',
      'team',
      'unlimited',
    ])
    expect(getLicense('personal').displayName).toBe('Personal Self Hosted')
  })

  test('personal is free', () => {
    const p = getLicense('personal')
    expect(p.yearlyUsd).toBe(0)
    expect(p.lifetimeUsd).toBe(0)
    expect(isPaidLicense('personal')).toBe(false)
    expect(lifetimeMultiple(p)).toBeNull()
  })

  test('paid prices', () => {
    const team = getLicense('team')
    expect(licensePriceUsd(team, 'yearly')).toBe(499)
    expect(licensePriceUsd(team, 'lifetime')).toBe(1349)
    const unl = getLicense('unlimited')
    expect(licensePriceUsd(unl, 'yearly')).toBe(999)
    expect(licensePriceUsd(unl, 'lifetime')).toBe(2999)
    expect(isPaidLicense('team')).toBe(true)
    expect(isPaidLicense('unlimited')).toBe(true)
  })

  test('lifetime is ~3× yearly on paid SKUs', () => {
    for (const sku of LICENSE_SKU_LIST.filter((s) => isPaidLicense(s.id))) {
      const m = lifetimeMultiple(sku)
      expect(m).toBeGreaterThanOrEqual(2.7)
      expect(m).toBeLessThan(3.1)
    }
  })

  test('hosts labels', () => {
    expect(licenseHostsLabel(getLicense('personal'))).toBe('Unlimited hosts')
    expect(licenseHostsLabel(getLicense('team'))).toBe('3 hosts')
    expect(licenseHostsLabel(getLicense('unlimited'))).toBe('Unlimited hosts')
  })

  test('Polar env keys and product names', () => {
    expect(licensePolarProductEnvKey('team', 'yearly')).toBe(
      'CHM_POLAR_LICENSE_TEAM_YEARLY'
    )
    expect(licensePolarProductName('unlimited', 'lifetime')).toBe(
      'chmonitor Unlimited License (Lifetime)'
    )
    expect(licensePolarPriceCents('team', 'yearly')).toBe(49900)
    expect(licensePolarPriceCents('unlimited', 'lifetime')).toBe(299900)
  })

  test('team is the featured SKU', () => {
    expect(getLicense('team').highlight).toBe(true)
    expect(LICENSE_SKU_LIST.filter((s) => s.highlight)).toHaveLength(1)
  })
})
