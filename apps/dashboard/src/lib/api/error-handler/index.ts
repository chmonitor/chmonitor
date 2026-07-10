/**
 * API Error Handler Module
 *
 * Provides consistent error handling and logging for API routes.
 * Wraps route handlers with try-catch, logs errors with context,
 * and returns standardized error responses.
 *
 * @example
 * ```ts
 * import { withApiHandler, createValidationError, getHostIdFromParams } from '@/lib/api/error-handler'
 *
 * export const GET = withApiHandler(
 *   async (request) => {
 *     const url = new URL(request.url)
 *     const hostId = getHostIdFromParams(url.searchParams)
 *     // Your logic here
 *     return Response.json({ data: 'success' })
 *   },
 *   { route: '/api/v1/data', method: 'GET' }
 * )
 * ```
 */

// Re-export all types
export type {
  ApiHandler,
  BillingLimitClassification,
  BillingLimitReason,
  ErrorClassification,
  ErrorDetails,
  RouteContext,
  StatusCodeMap,
} from './types'

// Export error classifier functions
export { classifyBillingLimit, classifyError } from './error-classifier'
// Export error response builder functions
export {
  createErrorResponse,
  createInternalErrorResponse,
  createNotFoundError,
  createValidationError,
  getStatusCodeForErrorType,
} from './error-response-builder'

import type { ApiHandler, RouteContext } from './types'

import { classifyError } from './error-classifier'
import {
  createErrorResponse,
  getStatusCodeForErrorType,
} from './error-response-builder'

/**
 * Wraps an API route handler with automatic error handling
 *
 * Catches all errors, classifies them, logs them with context,
 * and returns standardized error responses.
 *
 * @param handler - The route handler function to wrap
 * @param context - Optional route context for logging
 * @returns Wrapped handler with error handling
 *
 * @example
 * ```ts
 * export const GET = withApiHandler(
 *   async (request: Request) => {
 *     const url = new URL(request.url)
 *     const hostId = url.searchParams.get('hostId')
 *     return Response.json({ data: 'success' })
 *   },
 *   { route: '/api/v1/data', method: 'GET' }
 * )
 * ```
 */
export function withApiHandler(
  handler: ApiHandler,
  context?: RouteContext
): ApiHandler {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (err) {
      // Classify the error to determine type
      const { type, message } = classifyError(err)

      // Build error details
      const errorDetails = {
        type,
        message,
        details: {
          timestamp: new Date().toISOString(),
        },
      }

      // Get appropriate status code and create response
      const statusCode = getStatusCodeForErrorType(type)
      return createErrorResponse(errorDetails, statusCode, context)
    }
  }
}

/**
 * Extracts and validates hostId from URL search parameters
 *
 * @param searchParams - URLSearchParams object from request URL
 * @param context - Optional route context for error logging
 * @returns Parsed hostId (number or string)
 * @throws Error if hostId parameter is missing
 *
 * @example
 * ```ts
 * const url = new URL(request.url)
 * const hostId = getHostIdFromParams(url.searchParams, { route: '/api/v1/data' })
 * // hostId is now a number (if numeric) or string
 * ```
 */
export function getHostIdFromParams(
  searchParams: URLSearchParams,
  _context?: RouteContext
): number | string {
  const hostId = searchParams.get('hostId')

  if (!hostId) {
    // This will be caught by withApiHandler if used, or thrown directly
    throw new Error('Missing required parameter: hostId')
  }

  const parsed = parseInt(hostId, 10)
  return Number.isNaN(parsed) ? hostId : parsed
}
