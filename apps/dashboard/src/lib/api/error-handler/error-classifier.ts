/**
 * Error Classifier
 *
 * Analyzes error objects and messages to determine appropriate error types
 * for consistent error handling across the API layer.
 */

import type { ErrorClassification } from './types'

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
