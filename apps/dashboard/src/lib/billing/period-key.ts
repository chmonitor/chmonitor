/**
 * Monthly-meter period keying — anchors the AI monthly USD budget
 * (`ai-usage-store.ts`) and the host-overage peak meter (`host-usage-store.ts`)
 * to the owner's actual subscription billing cycle instead of the calendar
 * UTC month, so a mid-month cycle start doesn't get a budget zeroed early (or
 * a cycle straddling the 1st granted two partial budgets).
 *
 * Design: the stored subscription only carries `currentPeriodEnd` (not a
 * `currentPeriodStart`), but that end's day-of-month is a stable recurring
 * anchor — Polar renewals advance `currentPeriodEnd` forward by one interval
 * each cycle, so the *day* it lands on stays the same (clamped for short
 * months). `cycleStartKey` walks back from `now` to the most recent
 * occurrence of that anchor day to find the start of the current cycle.
 *
 * OSS/self-hosted invariant: no subscription (no D1, no row, lapsed) always
 * falls back to `utcMonthKey` — the calendar month remains the only key there,
 * unchanged from before this module existed.
 */

import { getSubscription } from './subscription-store'
import { isSubscriptionLive } from './user-subscription'

/** Returns the UTC month string 'YYYY-MM' for the given instant. */
export function utcMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the *next* month is the last day of `monthIndex`.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Clamp `day` to the last real day of `year`/`monthIndex` (e.g. 31 → 28/29 in February). */
function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex))
}

/**
 * Pure: given a recurring anchor day-of-month and `now`, return the
 * 'YYYY-MM-DD' UTC date of the start of the cycle containing `now`. An anchor
 * day beyond the current/previous month's length clamps to that month's last
 * day, so a day-31 anchor still resolves sensibly in a 30-day or February
 * month.
 */
export function cycleStartKey(
  anchorDay: number,
  now: Date = new Date()
): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const thisMonthAnchor = clampDay(y, m, anchorDay)

  let startY = y
  let startM = m
  if (d < thisMonthAnchor) {
    startM = m - 1
    if (startM < 0) {
      startM = 11
      startY = y - 1
    }
  }
  const startDay = clampDay(startY, startM, anchorDay)
  return `${startY}-${String(startM + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`
}

/**
 * Pure period-key derivation from a subscription's `currentPeriodEnd`. Kept
 * separate from the D1-resolving `periodKeyForOwner` below so the cycle-anchor
 * boundary math is unit-testable without a database.
 */
export function periodKeyFromSubscription(
  sub: { currentPeriodEnd: number | null } | null | undefined,
  now: Date = new Date()
): string {
  if (!sub?.currentPeriodEnd) return utcMonthKey(now)
  const anchorDay = new Date(sub.currentPeriodEnd * 1000).getUTCDate()
  return `period:${cycleStartKey(anchorDay, now)}`
}

/**
 * Resolve the monthly-meter period key for `ownerId`: anchored to their live
 * subscription's billing-cycle day-of-month when one exists, falling back to
 * the calendar UTC month otherwise (no subscription, D1 unavailable, lapsed —
 * OSS/self-hosted always takes this path). Fail-open: a lookup error also
 * falls back to the calendar month, so a store hiccup can only ever degrade to
 * the previous (calendar-month) behaviour, never crash a caller.
 */
export async function periodKeyForOwner(
  ownerId: string,
  now: Date = new Date()
): Promise<string> {
  try {
    const sub = await getSubscription(ownerId)
    if (sub && isSubscriptionLive(sub, Math.floor(now.getTime() / 1000))) {
      return periodKeyFromSubscription(sub, now)
    }
  } catch {
    // Fall through to the calendar-month fallback.
  }
  return utcMonthKey(now)
}
