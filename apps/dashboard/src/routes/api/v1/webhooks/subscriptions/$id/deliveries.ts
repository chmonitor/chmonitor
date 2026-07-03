/**
 * Recent deliveries for one subscription (plan 44) — the dead-letter/audit
 * view. GET /api/v1/webhooks/subscriptions/$id/deliveries
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { mapSubscriptionApiError } from '@/lib/events/api-errors'
import { resolveSubscriptionUserId } from '@/lib/events/auth'
import { getWebhookSubscriptionsServerConfig } from '@/lib/events/server-feature'
import {
  getSubscription,
  listDeliveries,
} from '@/lib/events/subscription-store'

const ROUTE_GET = {
  route: '/api/v1/webhooks/subscriptions/$id/deliveries',
  method: 'GET',
}

async function handleGet(subscriptionId: string): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'Webhook subscriptions are not enabled.',
      },
      501,
      ROUTE_GET
    )
  }

  try {
    const userId = await resolveSubscriptionUserId()
    // Ownership check FIRST — listDeliveries itself has no user_id column to
    // scope by, so a subscription id owned by someone else must 404 here
    // rather than leak another user's delivery history.
    const subscription = await getSubscription(userId, subscriptionId)
    if (!subscription) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Webhook subscription not found',
        },
        404,
        ROUTE_GET
      )
    }

    const deliveries = await listDeliveries(subscriptionId)
    return createSuccessResponse(deliveries)
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_GET)
  }
}

export const Route = createFileRoute(
  '/api/v1/webhooks/subscriptions/$id/deliveries'
)({
  server: {
    handlers: {
      GET: async ({ params }) => handleGet(params.id),
    },
  },
})
