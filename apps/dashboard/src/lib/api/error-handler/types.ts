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
 * Machine-readable reason for a billing-limit 402, surfaced to the
 * PaywallModal. Short form of the server-side `LimitReason`
 * (`lib/billing/entitlements.ts`) — `classifyBillingLimit` maps
 * `host_limit`/`seat_limit`/`ai_daily_limit`/`ai_budget_limit` onto these four
 * values. `alert_rule_limit` has no client reason (no 402 emits it yet).
 */
export type BillingLimitReason = 'host' | 'seat' | 'ai_daily' | 'ai_budget'

/** Result of classifying a 402 response body as a billing-limit hit. */
export interface BillingLimitClassification {
  readonly reason: BillingLimitReason
  /** Human-readable upgrade nudge (from the gate's `limitMessage()` call). */
  readonly message: string
  /** Billing owner's current plan id, e.g. 'free' — echoed by every gate. */
  readonly planId: string
}

/**
 * HTTP status code mapping
 */
export interface StatusCodeMap {
  readonly [key: string]: number
}
