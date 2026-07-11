/**
 * POST /api/v1/billing/checkout — start a Polar checkout for a subscribable plan.
 *
 * Body: { planId: 'free' | 'pro' | 'max', period: 'monthly' | 'yearly', posthogDistinctId?: string, returnPath?: string }
 * Returns: { url } — the Polar-hosted checkout URL to redirect the customer to.
 *
 * `returnPath` (optional) is a same-origin relative path checkout returns to on
 * success (onboarding sends `/` so a $0 Free checkout lands back on the app, not
 * `/billing`). Strictly validated (see safeReturnPath) and ignored if unsafe;
 * the default is `/billing`. `?status=success` is always appended.
 *
 * Free is a real $0 Polar subscription (monthly-only): the hosted checkout works
 * with no card, and `period` is forced to 'monthly' regardless of what the
 * client sends. Paid plans (pro/max) keep the explicit monthly/yearly choice.
 *
 * `externalCustomerId` is set to the billing-owner id (Clerk org id when the
 * user already has an active org; Clerk user id for a first-time upgrade). Polar
 * stamps every resulting webhook with `customer.externalId`. The `metadata`
 * always carries the actual Clerk userId so the webhook can lazily create a
 * Clerk org for the buyer on first payment.
 *
 * `posthogDistinctId` (optional, sent by the browser alongside `checkout_started`
 * — see `useBilling`/`startCheckout`) is forwarded into the Polar checkout
 * metadata unchanged. Polar propagates it onto the resulting subscription, so
 * the `subscription.created` webhook can stitch `upgrade_completed` back onto
 * the same PostHog distinct-id as the rest of the funnel (#2478) instead of the
 * shared server id. Absent when analytics is disabled/DNT — the webhook falls
 * back to the shared id in that case, never throwing.
 */
import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { logEvent } from '@/lib/audit/logEvent'
import { resolveBillingOwnerId } from '@/lib/billing/billing-owner'
import {
  getPolarClient,
  isBillingConfigured,
  isSubscribablePlanId,
  productIdFor,
} from '@/lib/billing/polar-config'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'

const ROUTE = { route: '/api/v1/billing/checkout', method: 'POST' }

/** Where checkout returns on success when the client sends no valid override. */
const DEFAULT_RETURN_PATH = '/billing'

/**
 * Validate a client-supplied post-checkout return path. Onboarding sends this so
 * a $0 Free checkout returns to `/` instead of `/billing`. Accept only a
 * same-origin relative path: must start with a single '/' (not '//', which the
 * browser reads as a protocol-relative URL to another host) and carry no query
 * or fragment (we append `?status=success` ourselves). Anything else is ignored
 * — falls back to the default rather than erroring, so a bad hint never blocks
 * checkout. This is an open-redirect guard: `returnPath` becomes part of the
 * Polar successUrl.
 */
function safeReturnPath(returnPath: unknown): string {
  if (
    typeof returnPath === 'string' &&
    returnPath.startsWith('/') &&
    !returnPath.startsWith('//') &&
    !returnPath.includes('?') &&
    !returnPath.includes('#')
  ) {
    return returnPath
  }
  return DEFAULT_RETURN_PATH
}

async function handlePost(request: Request): Promise<Response> {
  if (!isBillingConfigured()) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'Billing is not enabled.',
      },
      501,
      ROUTE
    )
  }

  let body: {
    planId?: string
    period?: string
    posthogDistinctId?: string
    returnPath?: string
  }
  try {
    body = (await request.json()) as {
      planId?: string
      period?: string
      posthogDistinctId?: string
      returnPath?: string
    }
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Body must be valid JSON',
      },
      400,
      ROUTE
    )
  }

  const { planId, period, posthogDistinctId, returnPath } = body
  if (!planId || !isSubscribablePlanId(planId)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'planId must be one of: free, pro, max',
      },
      400,
      ROUTE
    )
  }
  // Free is a $0 monthly-only product: force the period to monthly regardless of
  // what the client sent (there is no yearly Free product). Paid plans still
  // require an explicit valid period.
  let effectivePeriod: 'monthly' | 'yearly'
  if (planId === 'free') {
    effectivePeriod = 'monthly'
  } else if (period === 'monthly' || period === 'yearly') {
    effectivePeriod = period
  } else {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'period must be monthly or yearly',
      },
      400,
      ROUTE
    )
  }

  const productId = productIdFor(planId, effectivePeriod)
  if (!productId) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: `No Polar product configured for ${planId}/${effectivePeriod}.`,
      },
      501,
      ROUTE
    )
  }

  try {
    // userId = the actual Clerk user (for org creation in the webhook).
    // ownerId = billing owner: orgId when the user already has a paid org in
    //           session, userId otherwise (first-time upgrade from free).
    const [userId, ownerId] = await Promise.all([
      resolveConnectionUserId(),
      resolveBillingOwnerId(),
    ])
    const origin = new URL(request.url).origin
    const successUrl = `${origin}${safeReturnPath(returnPath)}?status=success`
    const checkout = await getPolarClient().checkouts.create({
      products: [productId],
      externalCustomerId: ownerId,
      successUrl,
      // userId in metadata lets the webhook lazily create a Clerk org for the
      // buyer when externalCustomerId was still a user id (first payment).
      // posthogDistinctId (when present) stitches upgrade_completed back onto
      // the browser's funnel distinct-id (#2478) — omitted entirely rather
      // than sent as undefined/empty so the webhook's "absent" fallback path
      // is unambiguous.
      metadata: {
        userId,
        planId,
        period: effectivePeriod,
        ...(posthogDistinctId ? { posthogDistinctId } : {}),
      },
    })

    // Best-effort audit trail — org-scoped only (a first-time upgrade with no
    // org yet has nothing to scope the row to; the webhook logs
    // billing.plan_changed once Polar confirms the org-scoped subscription).
    // Same `org_` id-prefix convention applySubscription() uses in
    // webhooks/polar.ts to tell an org owner from a user owner.
    if (ownerId.startsWith('org_')) {
      await logEvent({
        orgId: ownerId,
        userId,
        event: 'billing.checkout',
        resource: `${planId}:${effectivePeriod}`,
        action: 'create',
        result: 'success',
      })
    }

    return createSuccessResponse({ url: checkout.url })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE)
  }
}

export const Route = createFileRoute('/api/v1/billing/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
