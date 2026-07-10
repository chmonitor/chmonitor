import { ConnectionStoreError } from './types'
import {
  createErrorResponse as createApiErrorResponse,
  createInternalErrorResponse,
} from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { ConversationStoreError } from '@/lib/conversation-store/types'

export interface ConnectionRouteContext {
  route: string
  method: string
}

export function mapConnectionApiError(
  error: unknown,
  context: ConnectionRouteContext
): Response {
  if (error instanceof ConnectionStoreError) {
    const status =
      error.code === 'UNAUTHORIZED'
        ? 401
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'NOT_CONFIGURED'
            ? 501
            : error.code === 'LIMIT_EXCEEDED'
              ? 402
              : 500
    if (status === 500) {
      return createInternalErrorResponse(error, context)
    }
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  if (error instanceof ConversationStoreError) {
    if (error.code === 'UNAUTHORIZED') {
      return createApiErrorResponse(
        { type: ApiErrorType.PermissionError, message: error.message },
        401,
        context
      )
    }
    return createInternalErrorResponse(error, context)
  }

  return createInternalErrorResponse(error, context)
}
