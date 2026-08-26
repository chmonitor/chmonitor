/**
 * Error Handler Types
 *
 * Type definitions for the API error handling system.
 */

import type { ApiErrorType } from '@/lib/api/types'

/**
 * API route handler with automatic error handling
 *
 * @example
 * ```ts
 * export const GET = withApiHandler(
 *   async (request) => {
 *     return Response.json({ data: 'success' })
 *   },
 *   { route: '/api/v1/data', method: 'GET' }
 * )
 * ```
 */
export type ApiHandler = (request: Request) => Promise<Response>

/**
 * Route context for logging and error tracking
 */
export interface RouteContext {
  /** Route path (e.g., '/api/v1/charts/[name]') */
  readonly route?: string
  /** HTTP method (e.g., 'GET', 'POST') */
  readonly method?: string
  /** Host identifier for multi-instance configurations */
  readonly hostId?: number | string
}

/**
 * Error details for response creation
 *
 * Supports primitive values (string, number, boolean) and arrays of primitives
 * for compatibility with FetchDataError details structure.
 */
export interface ErrorDetails {
  /** Type of error that occurred */
  readonly type: ApiErrorType
  /** Human-readable error message */
  readonly message: string
  /** Additional error context for debugging */
  readonly details?: Record<
    string,
    | string
    | number
    | boolean
    | undefined
    | readonly string[]
    | readonly (string | number | boolean)[]
  >
}

/**
 * Error classification result
 */
export interface ErrorClassification {
  /** Detected error type */
  readonly type: ApiErrorType
  /** Extracted error message */
  readonly message: string
}

/**
 * HTTP status code mapping
 */
export interface StatusCodeMap {
  readonly [key: string]: number
}
