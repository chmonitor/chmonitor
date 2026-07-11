/**
 * Richer Polar subscription notifications.
 *
 * A raw `subscription.*` event doesn't say whether it's a brand-new signup, an
 * upgrade, a downgrade, or a cancellation — that depends on the PRIOR state.
 * `classifyTransition` is a pure function over (priorPlan, newPlan, status,
 * eventType) that resolves the human-meaningful transition, so the wording +
 * emoji are unit-testable without a webhook or a database. `formatPolarNotify`
 * renders the Telegram-HTML message (plan name, monthly value, period).
 */

import type { NotifyKind } from './telegram'

import { BILLING_PLANS, monthlyEquivalentUsd, type PlanId } from '@chm/pricing'

type Period = 'monthly' | 'yearly' | null

/** Tier ranking for upgrade/downgrade detection. */
const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  max: 2,
  enterprise: 3,
}

export type TransitionCase =
  | 'free_signup'
  | 'paid_new'
  | 'upgrade'
  | 'downgrade'
  | 'renewal'
  | 'cancel'
  | 'revoke'
  | 'past_due'

export interface Transition {
  case: TransitionCase
  kind: NotifyKind
  icon: string
}

export interface ClassifyInput {
  /** The owner's plan BEFORE this event (null when there was no prior row). */
  priorPlanId: PlanId | null
  newPlanId: PlanId
  /** Polar subscription status carried by the event. */
  status: string
  eventType: string
}

/**
 * Resolve the human-meaningful transition. Status wins first (a canceled /
 * revoked / past_due event is that regardless of plan movement); otherwise a
 * live event is classified by whether a prior plan existed and how the tier
 * moved.
 */
export function classifyTransition(input: ClassifyInput): Transition {
  const { priorPlanId, newPlanId, status } = input

  if (status === 'revoked') {
    return { case: 'revoke', kind: 'cancel', icon: '\u{274C}' } // ❌
  }
  if (status === 'canceled') {
    return { case: 'cancel', kind: 'cancel', icon: '\u{26A0}\u{FE0F}' } // ⚠️
  }
  if (status === 'past_due') {
    return { case: 'past_due', kind: 'payment_failure', icon: '\u{1F4B3}' } // 💳
  }

  // Live/active-ish event.
  if (priorPlanId === null) {
    return newPlanId === 'free'
      ? { case: 'free_signup', kind: 'subscription', icon: '\u{1F331}' } // 🌱
      : { case: 'paid_new', kind: 'subscription', icon: '\u{1F4B0}' } // 💰
  }

  const before = PLAN_RANK[priorPlanId]
  const after = PLAN_RANK[newPlanId]
  if (after > before) {
    return { case: 'upgrade', kind: 'plan_change', icon: '\u{2B06}\u{FE0F}' } // ⬆️
  }
  if (after < before) {
    return { case: 'downgrade', kind: 'plan_change', icon: '\u{2B07}\u{FE0F}' } // ⬇️
  }
  return { case: 'renewal', kind: 'plan_change', icon: '\u{1F504}' } // 🔄
}

const CASE_LABEL: Record<TransitionCase, string> = {
  free_signup: 'Free signup',
  paid_new: 'New subscription',
  upgrade: 'Upgrade',
  downgrade: 'Downgrade',
  renewal: 'Renewal / update',
  cancel: 'Cancellation',
  revoke: 'Revoked',
  past_due: 'Payment past due',
}

export interface FormatInput {
  transition: Transition
  priorPlanId: PlanId | null
  newPlanId: PlanId
  period: Period
  status: string
  owner: string
}

function planName(planId: PlanId): string {
  return BILLING_PLANS[planId]?.name ?? planId
}

/** Monthly value string, e.g. "$29/mo" or "$24.17/mo (billed yearly)". */
function valueLine(planId: PlanId, period: Period): string {
  const plan = BILLING_PLANS[planId]
  if (!plan) return ''
  const monthly = monthlyEquivalentUsd(
    plan,
    period === 'yearly' ? 'yearly' : 'monthly'
  )
  if (monthly == null) return 'custom pricing'
  const suffix = period === 'yearly' ? '/mo (billed yearly)' : '/mo'
  return `$${monthly}${suffix}`
}

export function formatPolarNotify(input: FormatInput): string {
  const { transition, priorPlanId, newPlanId, period, status, owner } = input
  const label = CASE_LABEL[transition.case]
  const value = valueLine(newPlanId, period)

  const planLine =
    transition.case === 'upgrade' || transition.case === 'downgrade'
      ? `plan: <b>${priorPlanId ? planName(priorPlanId) : '?'}</b> \u{2192} <b>${planName(newPlanId)}</b>`
      : `plan: <b>${planName(newPlanId)}</b>`

  const lines = [
    `${transition.icon} <b>${label}</b>`,
    planLine,
    value
      ? `${value} · ${period ?? 'n/a'} · status: ${status}`
      : `status: ${status}`,
    `owner: <code>${owner}</code>`,
  ]
  return lines.join('\n')
}
