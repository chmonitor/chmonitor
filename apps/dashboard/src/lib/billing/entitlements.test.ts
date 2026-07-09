import {
  checkAiBudget,
  checkAiDailyLimit,
  checkAlertRuleLimit,
  checkHostLimit,
  checkHostSoftCap,
  checkSeatLimit,
  hasCapability,
  hostOverageUsd,
  isWithinRetention,
  limitMessage,
  retentionCutoffMs,
} from './entitlements'
import { BILLING_PLANS, PLAN_IDS } from './plans'
import { describe, expect, test } from 'bun:test'

const { free, pro, max, enterprise } = BILLING_PLANS

describe('entitlements — host limit', () => {
  test('Free (1 host): blocks the 2nd, allows the 1st', () => {
    expect(checkHostLimit(free, 0).allowed).toBe(true)
    expect(checkHostLimit(free, 1).allowed).toBe(false)
    expect(checkHostLimit(free, 1).remaining).toBe(0)
    expect(checkHostLimit(free, 0).remaining).toBe(1)
  })

  test('Pro (1) and Max (3) honor their caps at the boundary', () => {
    expect(checkHostLimit(pro, 0).allowed).toBe(true)
    expect(checkHostLimit(pro, 1).allowed).toBe(false)
    expect(checkHostLimit(max, 2).allowed).toBe(true)
    expect(checkHostLimit(max, 3).allowed).toBe(false)
  })

  test('Enterprise is unlimited', () => {
    const c = checkHostLimit(enterprise, 9999)
    expect(c.allowed).toBe(true)
    expect(c.unlimited).toBe(true)
    expect(c.limit).toBeNull()
    expect(c.remaining).toBeNull()
  })

  test('carries plan identity + reason for the API error shape', () => {
    const c = checkHostLimit(pro, 1)
    expect(c.planId).toBe('pro')
    expect(c.planName).toBe('Pro')
    expect(c.reason).toBe('host_limit')
  })
})

describe('entitlements — host soft cap (overage)', () => {
  test('Free hard-caps: denies at its 1-host limit, no overage reported', () => {
    const c = checkHostSoftCap(free, 1)
    expect(c.allowed).toBe(false)
    expect(c.overageHosts).toBe(0)
  })

  test('Free allows under the cap, no overage', () => {
    const c = checkHostSoftCap(free, 0)
    expect(c.allowed).toBe(true)
    expect(c.overageHosts).toBe(0)
  })

  test('Pro soft-caps: allowed under the included allowance, no overage', () => {
    const c = checkHostSoftCap(pro, 0)
    expect(c.allowed).toBe(true)
    expect(c.overageHosts).toBe(0)
  })

  test('Pro soft-caps: the 2nd host (at the 1-host cap) is allowed and billable', () => {
    const c = checkHostSoftCap(pro, 1)
    expect(c.allowed).toBe(true)
    expect(c.overageHosts).toBe(1)
  })

  test('Pro soft-caps: the 3rd host is allowed and the overage count grows', () => {
    const c = checkHostSoftCap(pro, 2)
    expect(c.allowed).toBe(true)
    expect(c.overageHosts).toBe(2)
  })

  test('Max soft-caps the same way at its 3-host allowance', () => {
    expect(checkHostSoftCap(max, 2).overageHosts).toBe(0)
    expect(checkHostSoftCap(max, 3)).toEqual({
      allowed: true,
      overageHosts: 1,
    })
  })

  test('Enterprise (unlimited) is always allowed with no overage', () => {
    const c = checkHostSoftCap(enterprise, 9999)
    expect(c.allowed).toBe(true)
    expect(c.overageHosts).toBe(0)
  })

  test('defensive: negative/NaN current-host counts never allow negative overage', () => {
    expect(checkHostSoftCap(pro, -5)).toEqual({
      allowed: true,
      overageHosts: 0,
    })
    expect(checkHostSoftCap(pro, Number.NaN)).toEqual({
      allowed: true,
      overageHosts: 0,
    })
  })
})

describe('entitlements — host overage monthly math', () => {
  test('Pro: overageHosts * $15/host', () => {
    expect(hostOverageUsd(pro, 0)).toBe(0)
    expect(hostOverageUsd(pro, 1)).toBe(15)
    expect(hostOverageUsd(pro, 3)).toBe(45)
  })

  test('Max: overageHosts * $19/host', () => {
    expect(hostOverageUsd(max, 1)).toBe(19)
    expect(hostOverageUsd(max, 2)).toBe(38)
  })

  test('Free/Enterprise never owe host overage', () => {
    expect(hostOverageUsd(free, 5)).toBe(0)
    expect(hostOverageUsd(enterprise, 5)).toBe(0)
  })

  test('defensive: non-positive overage counts owe nothing', () => {
    expect(hostOverageUsd(pro, 0)).toBe(0)
    expect(hostOverageUsd(pro, -1)).toBe(0)
    expect(hostOverageUsd(pro, Number.NaN)).toBe(0)
  })
})

describe('entitlements — seat limit', () => {
  test('caps match each tier', () => {
    expect(checkSeatLimit(free, 1).allowed).toBe(false) // 1 seat used == cap
    expect(checkSeatLimit(pro, 2).allowed).toBe(true)
    expect(checkSeatLimit(pro, 3).allowed).toBe(false)
    expect(checkSeatLimit(max, 10).allowed).toBe(false)
    expect(checkSeatLimit(enterprise, 1_000).allowed).toBe(true)
  })
})

describe('entitlements — alert rules', () => {
  test('Free has zero rules — always blocked', () => {
    const c = checkAlertRuleLimit(free, 0)
    expect(c.limit).toBe(0)
    expect(c.allowed).toBe(false)
    expect(c.remaining).toBe(0)
  })

  test('Pro 10 / Max 50 boundaries; Enterprise unlimited', () => {
    expect(checkAlertRuleLimit(pro, 9).allowed).toBe(true)
    expect(checkAlertRuleLimit(pro, 10).allowed).toBe(false)
    expect(checkAlertRuleLimit(max, 49).allowed).toBe(true)
    expect(checkAlertRuleLimit(max, 50).allowed).toBe(false)
    expect(checkAlertRuleLimit(enterprise, 9999).allowed).toBe(true)
  })
})

describe('entitlements — AI daily message cap', () => {
  test('Free hard-caps at 5 messages/day (no overage)', () => {
    expect(checkAiDailyLimit(free, 4).allowed).toBe(true)
    expect(checkAiDailyLimit(free, 5).allowed).toBe(false)
    expect(checkAiDailyLimit(free, 5).remaining).toBe(0)
  })

  test('paid tiers soft-cap: allowed past the included allowance (overage)', () => {
    for (const plan of [pro, max]) {
      const c = checkAiDailyLimit(plan, 10_000)
      // Overage policy keeps them unblocked, but they are NOT unlimited — the
      // included allowance is still reported for the usage meter.
      expect(c.allowed).toBe(true)
      expect(c.unlimited).toBe(false)
      expect(c.limit).toBe(plan.aiRequestsPerDay)
    }
  })

  test('Enterprise is unlimited (no daily cap)', () => {
    const c = checkAiDailyLimit(enterprise, 10_000)
    expect(c.allowed).toBe(true)
    expect(c.unlimited).toBe(true)
  })
})

describe('entitlements — AI monthly USD budget', () => {
  test('blocks once the budget is spent', () => {
    expect(checkAiBudget(free, 0.49).allowed).toBe(true)
    expect(checkAiBudget(free, 0.5).allowed).toBe(false)
    expect(checkAiBudget(pro, 4.99).allowed).toBe(true)
    expect(checkAiBudget(pro, 5).allowed).toBe(false)
    expect(checkAiBudget(max, 20).allowed).toBe(false)
  })

  test('remaining budget is reported and never negative', () => {
    expect(checkAiBudget(pro, 2).remaining).toBe(3)
    expect(checkAiBudget(pro, 99).remaining).toBe(0)
  })

  test('Enterprise BYOK is unlimited', () => {
    const c = checkAiBudget(enterprise, 1_000)
    expect(c.allowed).toBe(true)
    expect(c.unlimited).toBe(true)
  })
})

describe('entitlements — defensive usage handling', () => {
  test('negative / NaN usage is treated as zero', () => {
    expect(checkHostLimit(pro, -5).used).toBe(0)
    expect(checkHostLimit(pro, Number.NaN).used).toBe(0)
    expect(checkHostLimit(pro, Number.NaN).allowed).toBe(true)
  })
})

describe('entitlements — capability gate', () => {
  test('reflects the plan ladder', () => {
    expect(hasCapability(free, 'core_monitoring')).toBe(true)
    expect(hasCapability(free, 'data_export')).toBe(false)
    expect(hasCapability(pro, 'data_export')).toBe(true)
    expect(hasCapability(pro, 'anomaly_detection')).toBe(true)
    expect(hasCapability(pro, 'fleet_view')).toBe(false)
    expect(hasCapability(max, 'fleet_view')).toBe(true)
    expect(hasCapability(max, 'custom_dashboards')).toBe(true)
    expect(hasCapability(max, 'webhook_integrations')).toBe(true)
    expect(hasCapability(max, 'sso_rbac_audit')).toBe(false)
    expect(hasCapability(enterprise, 'sso_rbac_audit')).toBe(true)
  })
})

describe('entitlements — retention window', () => {
  const NOW = 1_700_000_000_000

  test('cutoff is now minus retentionDays', () => {
    expect(retentionCutoffMs(free, NOW)).toBe(NOW - 7 * 86_400_000)
    expect(retentionCutoffMs(pro, NOW)).toBe(NOW - 30 * 86_400_000)
    expect(retentionCutoffMs(max, NOW)).toBe(NOW - 90 * 86_400_000)
  })

  test('Enterprise (custom retention) has no cutoff', () => {
    expect(retentionCutoffMs(enterprise, NOW)).toBeNull()
    expect(isWithinRetention(enterprise, 0, NOW)).toBe(true)
  })

  test('isWithinRetention respects the window edge', () => {
    const justInside = NOW - 7 * 86_400_000 + 1
    const justOutside = NOW - 7 * 86_400_000 - 1
    expect(isWithinRetention(free, justInside, NOW)).toBe(true)
    expect(isWithinRetention(free, justOutside, NOW)).toBe(false)
  })
})

describe('entitlements — messages', () => {
  test('every reason produces a non-empty upgrade nudge', () => {
    const checks = [
      checkHostLimit(free, 1),
      checkSeatLimit(free, 1),
      checkAlertRuleLimit(free, 0),
      checkAiDailyLimit(free, 25),
      checkAiBudget(free, 0.5),
    ]
    for (const c of checks) {
      expect(c.allowed).toBe(false)
      expect(limitMessage(c).length).toBeGreaterThan(0)
    }
  })

  test('alert-rule message differs when the plan grants zero rules', () => {
    expect(limitMessage(checkAlertRuleLimit(free, 0))).toContain(
      'not available'
    )
    expect(limitMessage(checkAlertRuleLimit(pro, 10))).toContain('10 alert')
  })
})

describe('entitlements — coverage across all plans', () => {
  test('each plan exposes a defined value for every metered dimension', () => {
    for (const id of PLAN_IDS) {
      const plan = BILLING_PLANS[id]
      // null is a valid (unlimited) value; undefined would be a bug.
      expect(plan.hosts !== undefined).toBe(true)
      expect(plan.seats !== undefined).toBe(true)
      expect(plan.alertRules !== undefined).toBe(true)
      expect(plan.aiRequestsPerDay !== undefined).toBe(true)
      expect(plan.aiMonthlyUsdBudget !== undefined).toBe(true)
      expect(plan.retentionDays !== undefined).toBe(true)
    }
  })
})
