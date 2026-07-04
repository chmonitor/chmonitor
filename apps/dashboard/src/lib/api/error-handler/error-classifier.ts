/**
 * Error Classifier
 *
 * Analyzes error objects and messages to determine appropriate error types
 * for consistent error handling across the API layer.
 */

import type {
  BillingLimitClassification,
  BillingLimitReason,
  ErrorClassification,
} from './types'

import { ApiErrorType } from '@/lib/api/types'

/**
 * Classification patterns for error detection
 * Maps keywords/patterns to their corresponding error types
 */
const CLASSIFICATION_PATTERNS: ReadonlyArray<{
  readonly type: ApiErrorType
  readonly keywords: ReadonlyArray<string>
}> = [
  {
    type: ApiErrorType.PermissionError,
    keywords: ['permission', 'access denied', 'unauthorized', 'forbidden'],
  },
  {
    type: ApiErrorType.TableNotFound,
    keywords: [
      'table',
      'not found',
      "doesn't exist",
      'does not exist',
      'missing',
      'unknown table',
    ],
  },
  {
    type: ApiErrorType.NetworkError,
    keywords: [
      'network',
      'connection',
      'econnrefused',
      'enotfound',
      'connect failed',
    ],
  },
  {
    type: ApiErrorType.TimeoutError,
    keywords: ['timeout', 'etimedout', 'socket timeout'],
  },
  {
    type: ApiErrorType.SslError,
    keywords: ['ssl', 'tls', 'certificate', 'handshake', '525', '526'],
  },
  {
    type: ApiErrorType.ValidationError,
    keywords: [
      'invalid',
      'missing',
      'required',
      'malformed',
      'syntax error',
      'parse error',
    ],
  },
]

/**
 * Classifies an error based on its message content
 *
 * @param error - The error to classify (Error object or unknown)
 * @returns Classification result with error type and message
 *
 * @example
 * ```ts
 * const error = new Error('Table not found: system.unknown_table')
 * const classification = classifyError(error)
 * // { type: ApiErrorType.TableNotFound, message: 'Table not found: system.unknown_table' }
 * ```
 */
export function classifyError(error: unknown): ErrorClassification {
  const message = extractErrorMessage(error)
  const normalizedMessage = message.toLowerCase()

  // Check for TableNotFound with specific patterns (table + not found/missing)
  if (
    normalizedMessage.includes('table') &&
    (normalizedMessage.includes('not found') ||
      normalizedMessage.includes("doesn't exist") ||
      normalizedMessage.includes('does not exist') ||
      normalizedMessage.includes('missing'))
  ) {
    return {
      type: ApiErrorType.TableNotFound,
      message,
    }
  }

  // Check other patterns in priority order
  for (const { type, keywords } of CLASSIFICATION_PATTERNS) {
    if (matchesAnyKeyword(normalizedMessage, keywords)) {
      return {
        type,
        message,
      }
    }
  }

  // Default to QueryError for unknown errors
  return {
    type: ApiErrorType.QueryError,
    message,
  }
}

/**
 * Extracts error message from Error objects or unknown values
 *
 * @param error - Error object or unknown value
 * @returns Extracted error message
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error occurred'
}

/**
 * Checks if message contains any of the provided keywords
 *
 * @param message - Normalized message to search
 * @param keywords - Keywords to search for
 * @returns True if any keyword is found
 */
function matchesAnyKeyword(
  message: string,
  keywords: ReadonlyArray<string>
): boolean {
  return keywords.some((keyword) => message.includes(keyword))
}

/**
 * Maps the server-side `LimitReason` (`lib/billing/entitlements.ts`) to the
 * short client reason the PaywallModal renders. `alert_rule_limit` is
 * deliberately absent — no route emits a 402 for it yet (see
 * `lib/billing/plan-enforcement.ts`), so it falls through to `null`.
 */
const LIMIT_REASON_MAP: Record<string, BillingLimitReason> = {
  host_limit: 'host',
  seat_limit: 'seat',
  ai_daily_limit: 'ai_daily',
  ai_budget_limit: 'ai_budget',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * A billing 402 body has shipped in two shapes so far, and this reads either
 * without requiring the routes to agree on one:
 *  - `createApiErrorResponse` (routes/api/v1/user-connections.ts): nested
 *    `{ error: { message, details: { reason, planId } } }`.
 *  - the agent route's raw `Response` (routes/api/v1/agent.ts): flat
 *    `{ error: <message string>, details: { reason, planId } }`.
 * Returns the raw (long-form) reason string, unmapped — callers translate it.
 */
function extractLimitFields(
  body: unknown
): { rawReason: string; message?: string; planId?: string } | null {
  if (!isRecord(body)) return null

  // Nested shape: error is itself an object carrying message + details.
  if (isRecord(body.error)) {
    const details = body.error.details
    const rawReason = isRecord(details) ? details.reason : undefined
    if (typeof rawReason !== 'string') return null
    return {
      rawReason,
      message:
        typeof body.error.message === 'string' ? body.error.message : undefined,
      planId:
        isRecord(details) && typeof details.planId === 'string'
          ? details.planId
          : undefined,
    }
  }

  // Flat shape: error is the message string itself; details sits at the top.
  const details = body.details
  const rawReason = isRecord(details) ? details.reason : undefined
  if (typeof rawReason !== 'string') return null
  return {
    rawReason,
    message: typeof body.error === 'string' ? body.error : undefined,
    planId:
      isRecord(details) && typeof details.planId === 'string'
        ? details.planId
        : undefined,
  }
}

/**
 * Classifies a fetch response's status + parsed JSON body as a billing-limit
 * 402, for the global PaywallModal (see `components/billing/paywall-modal.tsx`).
 * Returns `null` for anything else — non-402s, and 402s that aren't a
 * recognized billing-limit shape (e.g. a future `alert_rule_limit`) — so the
 * caller's existing error handling stays untouched for everything else.
 */
export function classifyBillingLimit(
  status: number,
  body: unknown
): BillingLimitClassification | null {
  if (status !== 402) return null

  const fields = extractLimitFields(body)
  if (!fields) return null

  const reason = LIMIT_REASON_MAP[fields.rawReason]
  if (!reason) return null

  return {
    reason,
    message: fields.message || "You've hit a plan limit. Upgrade for more.",
    planId: fields.planId || 'free',
  }
}
