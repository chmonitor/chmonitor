/**
 * Pull a billing owner's live entitlement straight from Polar — the source of
 * truth, independent of the webhook + D1 cache.
 *
 * Why: webhooks can be missed (delivery 5xx, a cold D1, a replayed event) and
 * the D1 row can drift. Reading the owner's CURRENT state from Polar by its
 * `externalId` (= the Clerk user id or org id we stamped on checkout) makes the
 * dashboard always reflect reality. The D1 row becomes a best-effort cache, not
 * the authority.
 *
 * Cancel-grace is native: Polar's customer STATE `activeSubscriptions` only
 * contains subscriptions that still grant access right now — a subscription set
 * to cancel at period end stays here (status `active`, `cancelAtPeriodEnd:true`)
 * until the period actually ends, then drops out. So "cancelled but paid through
 * the cycle" keeps the plan until the cycle ends, with no extra logic.
 */

import type { PlanId } from './plans'

import {
  getPolarClient,
  isBillingConfigured,
  planForProductId,
} from './polar-config'

export interface OwnerSubscription {
  planId: PlanId
  billingPeriod: 'monthly' | 'yearly' | null
  /** Polar status (active | trialing | …). Live by construction here. */
  status: string
  /** Unix seconds the current paid period runs until; access valid until then. */
  currentPeriodEnd: number | null
  /** True when the user cancelled but is still inside the paid period. */
  cancelAtPeriodEnd: boolean
}

const PLAN_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  max: 2,
  enterprise: 3,
}

function toUnixSeconds(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/**
 * Negative cache: externalIds Polar has confirmed have no active subscription
 * (free users / no Polar customer). Without it, every entitlement read for a
 * free user round-trips to Polar and 404s — the common case on a cloud deploy.
 *
 * Per-isolate and best-effort: the map lives only for the Worker isolate's
 * lifetime, which is plenty to collapse the burst of reads a single page load
 * fans out. A positive result clears the entry immediately (the user upgraded),
 * and transient API failures are NOT cached — only a definitive "no customer /
 * no active sub" — so a Polar blip never hides a real subscription.
 */
const NEGATIVE_TTL_MS = 60_000
const NEGATIVE_CACHE_MAX = 1000
const noActiveSubUntil = new Map<string, number>()

function hasFreshNegative(externalId: string): boolean {
  const until = noActiveSubUntil.get(externalId)
  if (until === undefined) return false
  if (until > Date.now()) return true
  noActiveSubUntil.delete(externalId)
  return false
}

function rememberNoActiveSub(externalId: string): void {
  // Bound memory: drop expired entries before growing past the cap.
  if (noActiveSubUntil.size >= NEGATIVE_CACHE_MAX) {
    const now = Date.now()
    for (const [id, until] of noActiveSubUntil) {
      if (until <= now) noActiveSubUntil.delete(id)
    }
  }
  noActiveSubUntil.set(externalId, Date.now() + NEGATIVE_TTL_MS)
}

/** True when the error is Polar's 404 "no customer for this externalId". */
function isResourceNotFound(error: unknown): boolean {
  const e = error as
    | {
        statusCode?: number
        status?: number
        response?: { status?: number }
        name?: string
      }
    | null
    | undefined
  const status = e?.statusCode ?? e?.status ?? e?.response?.status
  if (status === 404) return true
  return (
    typeof e?.name === 'string' && e.name.toLowerCase().includes('notfound')
  )
}

/** Test-only: clear the negative cache so cases don't leak state across tests. */
export function __resetPolarSubscriptionCacheForTests(): void {
  noActiveSubUntil.clear()
}

/**
 * Invalidate a negative-cache entry for an externalId, if one exists.
 *
 * Why: the webhook path (subscription.created/updated/active/...) writes the
 * D1 cache directly and never calls pullOwnerSubscriptionFromPolar, so a
 * negative entry recorded moments earlier (e.g. an entitlement check that ran
 * just before checkout completed) would otherwise survive until its TTL and
 * shadow the fresh D1 row whenever resolveOwnerSubscription's D1 read misses
 * or races the write — gating a just-paid user as free for up to a minute.
 * Call this from the webhook whenever a subscription becomes live/paid.
 */
export function invalidateNegativeCache(externalId: string): void {
  noActiveSubUntil.delete(externalId)
}

/**
 * The owner's current paid subscription per Polar, or null when they have none
 * (free), Polar is not configured, or the call fails (caller falls back to the
 * D1 cache / free). When several active subscriptions exist, the highest plan
 * wins.
 */
export async function pullOwnerSubscriptionFromPolar(
  externalId: string
): Promise<OwnerSubscription | null> {
  if (!isBillingConfigured()) return null
  // Free users (no Polar customer) would otherwise 404 against Polar on every
  // read — short-circuit those for a minute.
  if (hasFreshNegative(externalId)) return null
  try {
    const state = await getPolarClient().customers.getStateExternal({
      externalId,
    })
    const active =
      'activeSubscriptions' in state ? (state.activeSubscriptions ?? []) : []

    let best: OwnerSubscription | null = null
    for (const s of active) {
      const mapped = planForProductId(s.productId)
      if (!mapped) continue
      const candidate: OwnerSubscription = {
        planId: mapped.planId,
        billingPeriod: mapped.period,
        status: s.status,
        currentPeriodEnd: toUnixSeconds(s.currentPeriodEnd),
        cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
      }
      if (
        !best ||
        (PLAN_RANK[candidate.planId] ?? 0) > (PLAN_RANK[best.planId] ?? 0)
      ) {
        best = candidate
      }
    }
    if (best) noActiveSubUntil.delete(externalId)
    else rememberNoActiveSub(externalId)
    return best
  } catch (error) {
    // A definitive 404 (no Polar customer for this externalId yet) is cacheable
    // as "free". A transient API error is NOT — caching it would hide a real
    // subscription for the TTL — so only the 404 path remembers.
    if (isResourceNotFound(error)) rememberNoActiveSub(externalId)
    return null
  }
}
