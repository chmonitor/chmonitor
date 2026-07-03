/**
 * Webhook subscription by ID (plan 44)
 * PATCH  /api/v1/webhooks/subscriptions/$id — edit url/eventTypes/enabled
 * DELETE /api/v1/webhooks/subscriptions/$id
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { mapSubscriptionApiError } from '@/lib/events/api-errors'
import { resolveSubscriptionUserId } from '@/lib/events/auth'
import { parseEventTypes } from '@/lib/events/event-types'
import { getWebhookSubscriptionsServerConfig } from '@/lib/events/server-feature'
import {
  deleteSubscription,
  updateSubscription,
} from '@/lib/events/subscription-store'

const ROUTE_PATCH = {
  route: '/api/v1/webhooks/subscriptions/$id',
  method: 'PATCH',
}
const ROUTE_DELETE = {
  route: '/api/v1/webhooks/subscriptions/$id',
  method: 'DELETE',
}

const NOT_ENABLED_MESSAGE = 'Webhook subscriptions are not enabled.'

interface PatchRequest {
  url?: string
  eventTypes?: unknown
  enabled?: boolean
}

async function handlePatch(
  request: Request,
  subscriptionId: string
): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: NOT_ENABLED_MESSAGE },
      501,
      ROUTE_PATCH
    )
  }

  let body: PatchRequest
  try {
    body = (await request.json()) as PatchRequest
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_PATCH
    )
  }

  const url = body.url?.trim()
  if (url !== undefined) {
    if (!url || !url.startsWith('https://')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid "url": expected an HTTPS endpoint',
        },
        400,
        ROUTE_PATCH
      )
    }
    const ssrfError = await validateHostUrl(url)
    if (ssrfError) {
      return createApiErrorResponse(
        { type: ApiErrorType.ValidationError, message: ssrfError },
        400,
        ROUTE_PATCH
      )
    }
  }

  let eventTypes: ReturnType<typeof parseEventTypes> | undefined
  if (body.eventTypes !== undefined) {
    eventTypes = parseEventTypes(body.eventTypes)
    if (!eventTypes) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message:
            'Invalid "eventTypes": expected a non-empty array of known event types',
        },
        400,
        ROUTE_PATCH
      )
    }
  }

  try {
    const userId = await resolveSubscriptionUserId()
    const updated = await updateSubscription(userId, subscriptionId, {
      url,
      eventTypes: eventTypes ?? undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    })
    return createSuccessResponse({
      id: updated.id,
      url: updated.url,
      eventTypes: updated.eventTypes,
      enabled: updated.enabled,
      updatedAt: updated.updatedAt,
    })
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_PATCH)
  }
}

async function handleDelete(subscriptionId: string): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: NOT_ENABLED_MESSAGE },
      501,
      ROUTE_DELETE
    )
  }

  try {
    const userId = await resolveSubscriptionUserId()
    await deleteSubscription(userId, subscriptionId)
    return createSuccessResponse({ deleted: true })
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_DELETE)
  }
}

export const Route = createFileRoute('/api/v1/webhooks/subscriptions/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => handlePatch(request, params.id),
      DELETE: async ({ params }) => handleDelete(params.id),
    },
  },
})
