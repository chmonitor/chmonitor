export type {
  ApiHandler,
  ErrorClassification,
  ErrorDetails,
  RouteContext,
  StatusCodeMap,
} from './types'

export { classifyError } from './error-classifier'
export {
  createErrorResponse,
  createInternalErrorResponse,
  createNotFoundError,
  createValidationError,
  getStatusCodeForErrorType,
} from './error-response-builder'
export {
  SANITIZED_MESSAGES,
  sanitizeClickHouseError as sanitizeDbQueryError, // pragma: allowlist secret
} from './sanitize-error'

import type { ApiHandler, RouteContext } from './types'

import { classifyError } from './error-classifier'
import {
  createErrorResponse,
  getStatusCodeForErrorType,
} from './error-response-builder'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'

export function withApiHandler(
  handler: ApiHandler,
  context?: RouteContext
): ApiHandler {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (err) {
      const { type, message } = classifyError(err)

      const errorDetails = {
        type,
        message,
        details: {
          timestamp: new Date().toISOString(),
        },
      }

      const statusCode = getStatusCodeForErrorType(type)
      return createErrorResponse(errorDetails, statusCode, context)
    }
  }
}

export function getHostIdFromParams(
  searchParams: URLSearchParams,
  _context?: RouteContext
): number | string {
  const hostId = searchParams.get('hostId')

  if (!hostId) {
    // This will be caught by withApiHandler if used, or thrown directly
    throw new Error('Missing required parameter: hostId')
  }

  const parsed = parseHostIdParam(hostId)
  return Number.isNaN(parsed) ? hostId : parsed
}
