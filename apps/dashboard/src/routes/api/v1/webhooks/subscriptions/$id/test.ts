/**
 * Send a test ping (plan 44)
 * POST /api/v1/webhooks/subscriptions/$id/test
 *
 * Delivers a synthetic `webhook.ping` event directly to ONE subscription,
 * bypassing its configured `event_types` filter, and reports the outcome
 * immediately (unlike the fire-and-forget producer path in
 * `lib/events/outbound-bus.ts` — this is an explicit user action, so
 * awaiting the bounded 0/2s/8s retry sequence to report success/failure is
 * the whole point).
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { mapSubscriptionApiError } from '@/lib/events/api-errors'
import { resolveSubscriptionUserId } from '@/lib/events/auth'
import { PING_EVENT_TYPE } from '@/lib/events/event-types'
import { deliver } from '@/lib/events/outbound-bus'
import { getWebhookSubscriptionsServerConfig } from '@/lib/events/server-feature'
import { getSubscription } from '@/lib/events/subscription-store'

const ROUTE_POST = {
  route: '/api/v1/webhooks/subscriptions/$id/test',
  method: 'POST',
}

async function handlePost(subscriptionId: string): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'Webhook subscriptions are not enabled.',
      },
      501,
      ROUTE_POST
    )
  }

  try {
    const userId = await resolveSubscriptionUserId()
    const subscription = await getSubscription(userId, subscriptionId)
    if (!subscription) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Webhook subscription not found',
        },
        404,
        ROUTE_POST
      )
    }

    const outcome = await deliver(subscription, {
      id: crypto.randomUUID(),
      type: PING_EVENT_TYPE,
      occurred_at: new Date().toISOString(),
      data: { message: 'chmonitor webhook test ping' },
    })

    return createSuccessResponse(outcome)
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_POST)
  }
}

export const Route = createFileRoute('/api/v1/webhooks/subscriptions/$id/test')(
  {
    server: {
      handlers: {
        POST: async ({ params }) => handlePost(params.id),
      },
    },
  }
)
