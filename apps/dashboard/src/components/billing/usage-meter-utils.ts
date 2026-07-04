/**
 * Pure presentation logic for the billing usage meters (see `usage-summary.tsx`).
 *
 * Extracted out of the React component so the threshold colours, USD formatting,
 * "deferred limit" honesty note, and the renewal-banner decision can be asserted
 * directly in Bun without rendering (see `usage-meter-utils.test.ts`). No React,
 * no app-runtime imports — safe to pull into the client bundle.
 */

import {
  LIMIT_ENFORCEMENT,
  type LimitKey,
} from '@/lib/billing/plan-enforcement'

/** A used-vs-cap meter. `limit: null` (or `unlimited`) means no cap. */
export interface Meter {
  used: number
  limit: number | null
  unlimited: boolean
}

/** Severity band that drives a meter bar's colour. */
export type MeterLevel = 'normal' | 'amber' | 'red'

/** Amber once ≥ 60% of the cap is used; red once ≥ 80% (matches the paywall). */
const AMBER_AT = 0.6
const RED_AT = 0.8

/** Non-negative, finite usage — a store hiccup can only ever under-count. */
function safeUsed(used: number): number {
  return Number.isFinite(used) && used > 0 ? used : 0
}

/** Fraction of the cap consumed (0 when there is no cap to fill toward). */
function ratio(meter: Meter): number {
  const { limit, unlimited } = meter
  if (unlimited || limit == null || limit <= 0) return 0
  return safeUsed(meter.used) / limit
}

/**
 * Colour band for a meter. Unlimited / uncapped meters are always `normal`
 * (there is nothing to run out of). Red subsumes at/over-limit (ratio ≥ 0.8),
 * so a meter "turns red past 80%" as the plan requires.
 */
export function meterLevel(meter: Meter): MeterLevel {
  const r = ratio(meter)
  if (r >= RED_AT) return 'red'
  if (r >= AMBER_AT) return 'amber'
  return 'normal'
}

/** Bar fill 0–100 (clamped). 0 when the meter is unlimited / uncapped. */
export function meterPercent(meter: Meter): number {
  return Math.min(100, Math.round(ratio(meter) * 100))
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** e.g. `$0.00`, `$0.50`, `$12.34`. Non-finite input formats as `$0.00`. */
export function formatUsd(value: number): string {
  return USD.format(Number.isFinite(value) ? value : 0)
}

/**
 * Honesty note for a meter whose limit is advertised but not actually billed yet
 * (`deferred` in the enforcement registry). Returns `null` for enforced limits so
 * the meter reads as a real cap. Keeps the UI ⟺ enforcement in lockstep: flip a
 * limit to `deferred` and the note appears automatically.
 */
export function deferredNote(key: LimitKey): string | null {
  return LIMIT_ENFORCEMENT[key].status === 'deferred'
    ? 'not billed in early access'
    : null
}

/** What the renewal banner should render, or `hidden` when there's nothing to say. */
export type RenewalBannerState = 'hidden' | 'cancel' | 'renew'

/**
 * Decide the renewal banner from the subscription's renewal metadata. Free / never
 * subscribed (`status: 'none'` or no period end) is `hidden`; a pending
 * cancellation shows the grace `cancel` banner; an active period shows `renew`.
 */
export function renewalBannerState(renewal: {
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  status: string
}): RenewalBannerState {
  if (renewal.status === 'none' || renewal.currentPeriodEnd == null) {
    return 'hidden'
  }
  return renewal.cancelAtPeriodEnd ? 'cancel' : 'renew'
}
