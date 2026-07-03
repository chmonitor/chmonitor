/**
 * Client hooks for the billing surface.
 *
 * useBillingSubscription() reads the current plan; startCheckout()/openPortal()
 * POST to the billing routes and redirect the browser to the Polar-hosted page.
 */
import { useQuery } from '@tanstack/react-query'

import type { PlanId } from '@/lib/billing/plans'

import { trackEvent } from '@/lib/analytics/analytics'
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
    throw new Error(json?.error?.message || `Request failed (${res.status})`)
  }
  return json.data
}

export function useBillingSubscription() {
  return useQuery({
    queryKey: ['billing', 'subscription'],
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
    // stale value.
    refetchOnMount: 'always',
    retry: 5,
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

/** Begin a checkout for a paid plan; redirects to Polar on success. */
export async function startCheckout(
  planId: 'pro' | 'max',
  period: 'monthly' | 'yearly'
): Promise<void> {
  const url = await postForUrl('/api/v1/billing/checkout', { planId, period })
  trackEvent('checkout_started', { plan_id: planId, billing_period: period })
  window.location.href = url
}

/** Open the Polar customer portal for the signed-in user. */
export async function openBillingPortal(): Promise<void> {
  const url = await postForUrl('/api/v1/billing/portal')
  window.location.href = url
}
