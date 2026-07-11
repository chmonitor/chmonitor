/**
 * Polar transition classification + message wording, per case.
 */

import {
  classifyTransition,
  formatPolarNotify,
  type Transition,
} from './polar-notify'
import { describe, expect, test } from 'bun:test'

describe('classifyTransition', () => {
  test('a brand-new free subscription is a free signup', () => {
    const t = classifyTransition({
      priorPlanId: null,
      newPlanId: 'free',
      status: 'active',
      eventType: 'subscription.created',
    })
    expect(t.case).toBe('free_signup')
    expect(t.kind).toBe('subscription')
  })

  test('a brand-new paid subscription is a paid new', () => {
    const t = classifyTransition({
      priorPlanId: null,
      newPlanId: 'pro',
      status: 'active',
      eventType: 'subscription.created',
    })
    expect(t.case).toBe('paid_new')
    expect(t.kind).toBe('subscription')
  })

  test('pro → max is an upgrade', () => {
    const t = classifyTransition({
      priorPlanId: 'pro',
      newPlanId: 'max',
      status: 'active',
      eventType: 'subscription.updated',
    })
    expect(t.case).toBe('upgrade')
    expect(t.kind).toBe('plan_change')
  })

  test('max → pro is a downgrade', () => {
    const t = classifyTransition({
      priorPlanId: 'max',
      newPlanId: 'pro',
      status: 'active',
      eventType: 'subscription.updated',
    })
    expect(t.case).toBe('downgrade')
    expect(t.kind).toBe('plan_change')
  })

  test('same plan is a renewal/update', () => {
    const t = classifyTransition({
      priorPlanId: 'pro',
      newPlanId: 'pro',
      status: 'active',
      eventType: 'subscription.updated',
    })
    expect(t.case).toBe('renewal')
  })

  test('a canceled status wins over plan movement', () => {
    const t = classifyTransition({
      priorPlanId: 'pro',
      newPlanId: 'max',
      status: 'canceled',
      eventType: 'subscription.canceled',
    })
    expect(t.case).toBe('cancel')
    expect(t.kind).toBe('cancel')
  })

  test('a revoked status is a revoke', () => {
    const t = classifyTransition({
      priorPlanId: 'pro',
      newPlanId: 'pro',
      status: 'revoked',
      eventType: 'subscription.revoked',
    })
    expect(t.case).toBe('revoke')
    expect(t.kind).toBe('cancel')
  })

  test('a past_due status is a payment failure', () => {
    const t = classifyTransition({
      priorPlanId: 'pro',
      newPlanId: 'pro',
      status: 'past_due',
      eventType: 'subscription.past_due',
    })
    expect(t.case).toBe('past_due')
    expect(t.kind).toBe('payment_failure')
  })
})

describe('formatPolarNotify', () => {
  function fmt(overrides: Partial<Parameters<typeof formatPolarNotify>[0]>) {
    const transition: Transition = overrides.transition ?? {
      case: 'paid_new',
      kind: 'subscription',
      icon: '💰',
    }
    return formatPolarNotify({
      transition,
      priorPlanId: null,
      newPlanId: 'pro',
      period: 'monthly',
      status: 'active',
      owner: 'user_alice',
      ...overrides,
    })
  }

  test('a paid new includes plan name and monthly value', () => {
    const msg = fmt({})
    expect(msg).toContain('New subscription')
    expect(msg).toContain('Pro')
    expect(msg).toContain('$29/mo')
    expect(msg).toContain('user_alice')
  })

  test('a yearly value is normalized to a monthly figure with a note', () => {
    const msg = fmt({ newPlanId: 'max', period: 'yearly' })
    // 990 / 12 = 82.5
    expect(msg).toContain('$82.5/mo (billed yearly)')
  })

  test('an upgrade shows the from → to plan names', () => {
    const msg = fmt({
      transition: { case: 'upgrade', kind: 'plan_change', icon: '⬆️' },
      priorPlanId: 'pro',
      newPlanId: 'max',
    })
    expect(msg).toContain('Upgrade')
    expect(msg).toContain('Pro')
    expect(msg).toContain('Max')
  })
})
