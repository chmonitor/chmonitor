import { checkAiBudget, checkHostLimit } from './entitlements'
import {
  CAPABILITY_ENFORCEMENT,
  LIMIT_ENFORCEMENT,
  type LimitKey,
} from './plan-enforcement'
import { describe, expect, test } from 'bun:test'
import {
  BILLING_PLAN_LIST,
  BILLING_PLANS,
  type PlanCapability,
  planAiUsage,
  planAlertRules,
  planHosts,
  planRetention,
  planSeats,
} from '@chm/pricing'

/** Every capability that appears on any plan — the contract surface. */
const usedCapabilities = new Set<PlanCapability>(
  BILLING_PLAN_LIST.flatMap((p) => p.capabilities)
)

describe('plan-enforcement — anti-drift coverage', () => {
  test('every advertised capability is classified', () => {
    for (const cap of usedCapabilities) {
      // If this fails, a capability was added to @chm/pricing without deciding
      // whether/how it is enforced. Classify it in CAPABILITY_ENFORCEMENT.
      expect(CAPABILITY_ENFORCEMENT[cap]).toBeDefined()
    }
  })

  test('every numeric limit is classified', () => {
    const limitKeys: LimitKey[] = [
      'hosts',
      'hostOverage',
      'seats',
      'alertRules',
      'retentionDays',
      'aiRequestsPerDay',
      'aiMonthlyUsdBudget',
    ]
    for (const key of limitKeys) {
      expect(LIMIT_ENFORCEMENT[key]).toBeDefined()
    }
  })

  test('an "enforced" claim must name its gate', () => {
    const all = [
      ...Object.values(CAPABILITY_ENFORCEMENT),
      ...Object.values(LIMIT_ENFORCEMENT),
    ]
    for (const e of all) {
      if (e.status === 'enforced') {
        expect(e.gate.length).toBeGreaterThan(0)
      }
    }
  })

  test('the cost/abuse-bounded limits are enforced; alertRules is inherent', () => {
    // Enforcement is live for the limits that cap a cost/abuse vector. Custom
    // alert rules ship for every edition; there is no numeric cap to gate after
    // dashboard Polar seats were removed.
    expect(LIMIT_ENFORCEMENT.hosts.status).toBe('inherent')
    expect(LIMIT_ENFORCEMENT.seats.status).toBe('inherent')
    expect(LIMIT_ENFORCEMENT.aiRequestsPerDay.status).toBe('enforced')
    expect(LIMIT_ENFORCEMENT.aiMonthlyUsdBudget.status).toBe('enforced')
    expect(LIMIT_ENFORCEMENT.retentionDays.status).toBe('enforced')
    expect(LIMIT_ENFORCEMENT.alertRules.status).toBe('inherent')
  })

  test('alerting capabilities match the shipped feature, not a missing-feature stub', () => {
    expect(CAPABILITY_ENFORCEMENT.alerting_basic.status).toBe('inherent')
    expect(CAPABILITY_ENFORCEMENT.alerting_advanced.status).toBe('inherent')
  })

  test('host overage is honestly deferred pending Polar usage reporting', () => {
    // The local meter is live (host-usage-store.ts), but nothing reports usage
    // to Polar yet — never claim billed revenue for an integration that isn't wired.
    expect(LIMIT_ENFORCEMENT.hostOverage.status).toBe('inherent')
  })

  test('api_mcp_access is the enforced capability gate', () => {
    expect(CAPABILITY_ENFORCEMENT.api_mcp_access.status).toBe('enforced')
  })
})

describe('plan-enforcement — monthly AI USD budget really blocks', () => {
  test('a bounded plan blocks once spend reaches the budget', () => {
    const pro = BILLING_PLANS.pro
    expect(pro.aiMonthlyUsdBudget).toBe(5)
    // Under budget → allowed; at/over budget → denied.
    expect(checkAiBudget(pro, 4.99).allowed).toBe(true)
    expect(checkAiBudget(pro, 5).allowed).toBe(false)
    expect(checkAiBudget(pro, 6).allowed).toBe(false)
  })

  test('the free plan enforces its small trial budget', () => {
    const free = BILLING_PLANS.free
    expect(free.aiMonthlyUsdBudget).toBe(0.5)
    expect(checkAiBudget(free, 0).allowed).toBe(true)
    expect(checkAiBudget(free, 0.5).allowed).toBe(false)
  })

  test('Enterprise (BYOK / unlimited budget) never blocks', () => {
    const ent = BILLING_PLANS.enterprise
    expect(ent.aiMonthlyUsdBudget).toBeNull()
    expect(checkAiBudget(ent, 10_000).allowed).toBe(true)
    expect(checkAiBudget(ent, 10_000).unlimited).toBe(true)
  })
})

describe('plan-enforcement — no host or seat cap', () => {
  test('every plan allows any host count', () => {
    for (const plan of BILLING_PLAN_LIST) {
      expect(plan.hosts).toBeNull()
      expect(checkHostLimit(plan, 10_000).allowed).toBe(true)
    }
  })
})

describe('plan-enforcement — cross-surface render parity', () => {
  // The landing comparison matrix and the in-app billing matrix both derive
  // from these shared helpers. Pin the exact strings so a future change to the
  // helper (which would silently change BOTH surfaces) is caught here.
  test('limit cells render the agreed strings for every tier', () => {
    expect(BILLING_PLAN_LIST.map(planHosts)).toEqual([
      'Unlimited',
      'Unlimited',
      'Unlimited',
      'Unlimited',
    ])
    expect(BILLING_PLAN_LIST.map(planSeats)).toEqual([
      'Unlimited',
      'Unlimited',
      'Unlimited',
      'Unlimited',
    ])
    expect(BILLING_PLAN_LIST.map(planAlertRules)).toEqual([
      '—',
      '10',
      '50',
      'Unlimited',
    ])
    expect(BILLING_PLAN_LIST.map(planRetention)).toEqual([
      '7 days',
      '30 days',
      '90 days',
      'Custom',
    ])
    expect(BILLING_PLAN_LIST.map(planAiUsage)).toEqual([
      '5 messages / day',
      '100 messages / day, then $5 / 2,000',
      '1,000 messages / day, then $5 / 2,000',
      'BYOK',
    ])
  })
})
