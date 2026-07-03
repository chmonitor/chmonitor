/**
 * Webhook subscriptions API (plan 44)
 * GET  /api/v1/webhooks/subscriptions — list (user-scoped, secret redacted)
 * POST /api/v1/webhooks/subscriptions — create (SSRF-guarded, secret returned once)
 */

import { createFileRoute } from '@tanstack/react-router'

import type { WebhookSubscription } from '@/lib/events/subscription-store'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { mapSubscriptionApiError } from '@/lib/events/api-errors'
import { resolveSubscriptionUserId } from '@/lib/events/auth'
import { parseEventTypes } from '@/lib/events/event-types'
import { getWebhookSubscriptionsServerConfig } from '@/lib/events/server-feature'
import {
  createSubscription,
  listSubscriptions,
} from '@/lib/events/subscription-store'

const ROUTE_GET = { route: '/api/v1/webhooks/subscriptions', method: 'GET' }
const ROUTE_POST = { route: '/api/v1/webhooks/subscriptions', method: 'POST' }

const NOT_ENABLED_MESSAGE = 'Webhook subscriptions are not enabled.'

/** Redacts the HMAC secret — only the create response reveals it (once). */
function toPublicSubscription(sub: WebhookSubscription) {
  return {
    id: sub.id,
    url: sub.url,
    eventTypes: sub.eventTypes,
    enabled: sub.enabled,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  }
}

async function handleGet(): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: NOT_ENABLED_MESSAGE },
      501,
      ROUTE_GET
    )
  }

  try {
    const userId = await resolveSubscriptionUserId()
    const subscriptions = await listSubscriptions(userId)
    return createSuccessResponse(subscriptions.map(toPublicSubscription))
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_GET)
  }
}

interface CreateRequest {
  url?: string
  eventTypes?: unknown
}

async function handlePost(request: Request): Promise<Response> {
  if (!getWebhookSubscriptionsServerConfig().enabled) {
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: NOT_ENABLED_MESSAGE },
      501,
      ROUTE_POST
    )
  }

  let body: CreateRequest
  try {
    body = (await request.json()) as CreateRequest
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_POST
    )
  }

  const url = body.url?.trim()
  if (!url || !url.startsWith('https://')) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Missing or invalid "url": expected an HTTPS endpoint',
      },
      400,
      ROUTE_POST
    )
  }

  const eventTypes = parseEventTypes(body.eventTypes)
  if (!eventTypes) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Missing or invalid "eventTypes": expected a non-empty array of known event types',
      },
      400,
      ROUTE_POST
    )
  }

  // SSRF guard at CREATE time too (delivery re-validates on every send — see
  // `lib/events/outbound-bus.ts` — this just fails fast with a clear error
  // instead of silently accepting a subscription that can never deliver).
  const ssrfError = await validateHostUrl(url)
  if (ssrfError) {
    return createApiErrorResponse(
      { type: ApiErrorType.ValidationError, message: ssrfError },
      400,
      ROUTE_POST
    )
  }

  try {
    const userId = await resolveSubscriptionUserId()
    const created = await createSubscription(userId, { url, eventTypes })
    // Secret is revealed exactly once, in this create response.
    return createSuccessResponse(
      { ...toPublicSubscription(created), secret: created.secret },
      undefined,
      201
    )
  } catch (error) {
    return mapSubscriptionApiError(error, ROUTE_POST)
  }
}

export const Route = createFileRoute('/api/v1/webhooks/subscriptions')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})
