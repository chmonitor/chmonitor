/**
 * Client hooks for the billing surface.
 *
 * useBillingSubscription() reads the current plan; startCheckout()/openPortal()
 * POST to the billing routes and redirect the browser to the Polar-hosted page.
 */
import { useQuery } from '@tanstack/react-query'

import type { PlanId } from '@/lib/billing/plans'

import { getDistinctId, trackEvent } from '@/lib/analytics/analytics'
import { retryBillingUnlessAuthError } from '@/lib/billing/retry'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { apiFetch } from '@/lib/swr/api-fetch'

export interface BillingSubscription {
  planId: PlanId
  status: string
  billingPeriod: 'monthly' | 'yearly' | null
  currentPeriodEnd: number | null
  /** True when cancelled but still within the paid period (grace). */
  cancelAtPeriodEnd?: boolean
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { message?: string }
}

/**
 * apiFetch does NOT throw on a non-2xx JSON response (it treats application/json
 * as a stream and returns it), so every billing call must check status + the
 * envelope itself — otherwise an error response silently becomes `data:
 * undefined` and the caller mistakes it for success.
 */
async function readEnvelope<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || !json?.success || json.data === undefined) {
    throw new BillingRequestError(
      json?.error?.message || `Request failed (${res.status})`,
      res.status
    )
  }
  return json.data
}

/** Error carrying the HTTP status so the retry predicate can skip 401/403. */
export class BillingRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BillingRequestError'
    this.status = status
  }
}

export function useBillingSubscription() {
  // Billing is a Cloud-only surface. On self-hosted / OSS (no Clerk) the route
  // resolves no billing owner and returns 401 on every call — with `retry: 5`
  // + `refetchOnMount: 'always'` that floods the console/Sentry on every focus.
  // Gate the query off entirely when not in cloud mode (mirrors how the nav
  // already hides the plan label off cloud), so OSS never hits the endpoint.
  const cloud = isCloudModeClient()
  return useQuery({
    queryKey: ['billing', 'subscription'],
    enabled: cloud,
    queryFn: async (): Promise<BillingSubscription> => {
      const res = await apiFetch('/api/v1/billing/subscription')
      return readEnvelope<BillingSubscription>(res)
    },
    staleTime: 60_000,
    // The Clerk __session cookie is short-lived and is refreshed a few seconds
    // after a cold load; a billing query that fires before the refresh 401s and
    // would otherwise cache "free" for the whole session. Always refetch on
    // mount and keep retrying (capped ~4s delay, ~15s total) so the request
    // lands once the fresh cookie is in place and the real plan replaces the
    // stale value. A deterministic 401/403 (auth genuinely unavailable) is NOT
    // retried — retrying can never make it succeed, it only spams.
    refetchOnMount: 'always',
    retry: retryBillingUnlessAuthError,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  })
}

async function postForUrl(route: string, body?: unknown): Promise<string> {
  const res = await apiFetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const { url } = await readEnvelope<{ url: string }>(res)
  if (!url) throw new Error('No redirect URL returned')
  return url
}

/**
 * Begin a checkout for a subscribable plan; redirects to Polar on success.
 * Free is a real $0 Polar product (monthly only, no card at checkout) so the
 * signup gate can require an active subscription before the first host.
 * `returnPath` (same-origin relative path) overrides the default `/billing`
 * post-checkout destination — onboarding passes `/` to land back on setup.
 */
export async function startCheckout(
  planId: 'free' | 'pro' | 'max',
  period: 'monthly' | 'yearly',
  options?: { returnPath?: string }
): Promise<void> {
  // Attach the browser's PostHog distinct-id so the Polar webhook can stitch
  // upgrade_completed onto the same funnel session (#2478) instead of the
  // shared server id. Undefined (analytics disabled/DNT/not-yet-init) is
  // dropped by postForUrl's JSON.stringify — the checkout route treats that
  // as "absent" and falls back cleanly.
  const posthogDistinctId = await getDistinctId()
  const url = await postForUrl('/api/v1/billing/checkout', {
    planId,
    period,
    posthogDistinctId,
    returnPath: options?.returnPath,
  })
  trackEvent('checkout_started', { plan_id: planId, billing_period: period })
  window.location.href = url
}

/** Open the Polar customer portal for the signed-in user. */
export async function openBillingPortal(): Promise<void> {
  const url = await postForUrl('/api/v1/billing/portal')
  window.location.href = url
}

export interface CanDowngradeExceededLimit {
  metric: string
  used: number
  targetLimit: number | null
  message: string
}

export interface CanDowngradeResult {
  ok: boolean
  exceeded: CanDowngradeExceededLimit[]
}

/**
 * Pre-flight check before sending the user to the portal to change plans —
 * see POST /api/v1/billing/can-downgrade. Fails open on the server (OSS/no
 * Clerk returns `{ ok: true, exceeded: [] }`), so callers only need to handle
 * the network-level failure case (report it, don't block the change).
 */
export async function checkCanDowngrade(
  targetPlanId: string
): Promise<CanDowngradeResult> {
  const res = await apiFetch('/api/v1/billing/can-downgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPlanId }),
  })
  return readEnvelope<CanDowngradeResult>(res)
}
