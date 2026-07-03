/**
 * Maps `WebhookSubscriptionStoreError` (+ auth errors) to HTTP responses.
 * Mirrors `lib/connection-store/api-errors.ts`.
 */

import { WebhookSubscriptionStoreError } from './subscription-store'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { ConversationStoreError } from '@/lib/conversation-store/types'

export interface SubscriptionRouteContext {
  route: string
  method: string
}

export function mapSubscriptionApiError(
  error: unknown,
  context: SubscriptionRouteContext
): Response {
  if (error instanceof WebhookSubscriptionStoreError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'NOT_CONFIGURED'
          ? 501
          : 500
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  if (error instanceof ConversationStoreError) {
    const status = error.code === 'UNAUTHORIZED' ? 401 : 500
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  return createApiErrorResponse(
    {
      type: ApiErrorType.QueryError,
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    500,
    context
  )
}
