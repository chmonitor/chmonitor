/**
 * POST /api/v1/billing/portal — open the Polar customer portal.
 *
 * Returns: { url } — a customer-session portal URL where the user can manage,
 * upgrade, or cancel their subscription and update payment details. Polar hosts
 * the whole UI; we just mint a session for the billing owner via externalId.
 *
 * Must use the BILLING OWNER's id (org or user, from resolveBillingOwner()),
 * not the raw session user id — paid subscriptions are stamped with the org's
 * externalId, so an org member requesting a session under their own user id
 * 404s against Polar (no customer exists for that externalId).
 */
import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { getPolarClient, isBillingConfigured } from '@/lib/billing/polar-config'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'

const ROUTE = { route: '/api/v1/billing/portal', method: 'POST' }

async function handlePost(): Promise<Response> {
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

  try {
    const owner = await resolveBillingOwner()
    const session = await getPolarClient().customerSessions.create({
      externalCustomerId: owner.id,
    })
    return createSuccessResponse({ url: session.customerPortalUrl })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE)
  }
}

export const Route = createFileRoute('/api/v1/billing/portal')({
  server: {
    handlers: {
      POST: async () => handlePost(),
    },
  },
})
