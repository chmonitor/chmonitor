/**
 * POST /api/v1/billing/checkout — start a Polar checkout for a paid plan.
 *
 * Body: { planId: 'pro' | 'max', period: 'monthly' | 'yearly' }
 * Returns: { url } — the Polar-hosted checkout URL to redirect the customer to.
 *
 * `externalCustomerId` is set to the billing-owner id (Clerk org id when the
 * user already has an active org; Clerk user id for a first-time upgrade). Polar
 * stamps every resulting webhook with `customer.externalId`. The `metadata`
 * always carries the actual Clerk userId so the webhook can lazily create a
 * Clerk org for the buyer on first payment.
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
  isPaidPlanId,
  productIdFor,
} from '@/lib/billing/polar-config'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'

const ROUTE = { route: '/api/v1/billing/checkout', method: 'POST' }

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

  let body: { planId?: string; period?: string }
  try {
    body = (await request.json()) as { planId?: string; period?: string }
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

  const { planId, period } = body
  if (!planId || !isPaidPlanId(planId)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'planId must be one of: pro, max',
      },
      400,
      ROUTE
    )
  }
  if (period !== 'monthly' && period !== 'yearly') {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'period must be monthly or yearly',
      },
      400,
      ROUTE
    )
  }

  const productId = productIdFor(planId, period)
  if (!productId) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: `No Polar product configured for ${planId}/${period}.`,
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
    const checkout = await getPolarClient().checkouts.create({
      products: [productId],
      externalCustomerId: ownerId,
      successUrl: `${origin}/billing?status=success`,
      // userId in metadata lets the webhook lazily create a Clerk org for the
      // buyer when externalCustomerId was still a user id (first payment).
      metadata: { userId, planId, period },
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
        resource: `${planId}:${period}`,
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
