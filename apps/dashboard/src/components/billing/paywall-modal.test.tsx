/**
 * Logic-only Bun tests for the paywall surface (plan 15). The modal component
 * itself is a thin render of these pure functions + `classifyBillingLimit`
 * (see error-classifier.ts) — no DOM rendering here, per this repo's
 * convention of Bun for logic / Cypress for interaction.
 */
import { describe, expect, test } from 'bun:test'

import { classifyBillingLimit } from '@/lib/api/error-handler/error-classifier'
import {
  enforcementForReason,
  findNextTier,
  formatReasonCap,
  REASON_TITLES,
  resolveCurrentPlan,
  resolveUpgradeAction,
} from './paywall-logic'

describe('classifyBillingLimit', () => {
  test('classifies the nested error-response-builder 402 shape (host limit)', () => {
    const body = {
      success: false,
      error: {
        message: 'Host limit reached (1/1). Upgrade to add more hosts.',
        details: { reason: 'host_limit', planId: 'free', limit: 1 },
      },
    }
    expect(classifyBillingLimit(402, body)).toEqual({
      reason: 'host',
      message: 'Host limit reached (1/1). Upgrade to add more hosts.',
      planId: 'free',
    })
  })

  test('classifies the flat agent-route 402 shape (ai_daily / ai_budget)', () => {
    const daily = {
      error: 'Daily AI limit reached (5/5).',
      details: { reason: 'ai_daily_limit', planId: 'free' },
    }
    expect(classifyBillingLimit(402, daily)).toEqual({
      reason: 'ai_daily',
      message: 'Daily AI limit reached (5/5).',
      planId: 'free',
    })

    const budget = {
      error: 'Monthly AI budget reached ($5.00/$5.00).',
      details: { reason: 'ai_budget_limit', planId: 'pro' },
    }
    expect(classifyBillingLimit(402, budget)).toEqual({
      reason: 'ai_budget',
      message: 'Monthly AI budget reached ($5.00/$5.00).',
      planId: 'pro',
    })
  })

  test('classifies seat_limit', () => {
    const body = {
      error: {
        message: 'Seat limit reached.',
        details: { reason: 'seat_limit', planId: 'pro' },
      },
    }
    expect(classifyBillingLimit(402, body)?.reason).toBe('seat')
  })

  test('returns null for a 402 with an unrecognized reason (e.g. alert_rule_limit)', () => {
    const body = {
      error: {
        message: 'nope',
        details: { reason: 'alert_rule_limit', planId: 'free' },
      },
    }
    expect(classifyBillingLimit(402, body)).toBeNull()
  })

  test('returns null for non-402 statuses regardless of body shape', () => {
    const body = {
      error: {
        message: 'Host limit reached.',
        details: { reason: 'host_limit', planId: 'free' },
      },
    }
    expect(classifyBillingLimit(200, body)).toBeNull()
    expect(classifyBillingLimit(500, body)).toBeNull()
  })

  test('returns null for malformed / unrelated bodies', () => {
    expect(classifyBillingLimit(402, null)).toBeNull()
    expect(classifyBillingLimit(402, {})).toBeNull()
    expect(classifyBillingLimit(402, { error: 'Internal error' })).toBeNull()
  })
})

describe('paywall-logic — honest enforced/deferred copy', () => {
  test('all four reasons resolve a title', () => {
    for (const reason of ['host', 'seat', 'ai_daily', 'ai_budget'] as const) {
      expect(REASON_TITLES[reason]).toBeTruthy()
    }
  })

  test('host/seat/ai_daily/ai_budget are all `enforced` per plan-enforcement.ts (hard CTA)', () => {
    for (const reason of ['host', 'seat', 'ai_daily', 'ai_budget'] as const) {
      expect(enforcementForReason(reason).status).toBe('enforced')
    }
  })

  test('formatReasonCap renders Unlimited for null caps and $/mo for ai_budget', () => {
    const enterprise = resolveCurrentPlan('enterprise')
    expect(formatReasonCap('host', enterprise)).toBe('Unlimited')
    const free = resolveCurrentPlan('free')
    expect(formatReasonCap('ai_budget', free)).toBe('$0.5/mo')
    expect(formatReasonCap('host', free)).toBe('1')
  })

  test('findNextTier walks free -> pro -> max -> enterprise per metric', () => {
    const next = findNextTier('free', 'host')
    expect(next?.id).toBe('pro')
  })

  test('resolveCurrentPlan falls back to free for an unknown planId', () => {
    expect(resolveCurrentPlan('not-a-real-plan').id).toBe('free')
  })

  test('resolveUpgradeAction: free -> checkout for the next paid tier', () => {
    const next = findNextTier('free', 'host')
    expect(resolveUpgradeAction('free', next)).toEqual({
      kind: 'checkout',
      planId: 'pro',
    })
  })

  test('resolveUpgradeAction: already-paid owner -> portal (fresh checkout would 4xx)', () => {
    const next = findNextTier('pro', 'host')
    expect(resolveUpgradeAction('pro', next)).toEqual({ kind: 'portal' })
  })

  test('resolveUpgradeAction: next tier is enterprise -> contact (no self-serve checkout)', () => {
    expect(
      resolveUpgradeAction('max', resolveCurrentPlan('enterprise'))
    ).toEqual({
      kind: 'contact',
    })
  })

  test('resolveUpgradeAction: no next tier -> none', () => {
    expect(resolveUpgradeAction('enterprise', null)).toEqual({ kind: 'none' })
  })
})
