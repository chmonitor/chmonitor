/**
 * ClickHouse Error Sanitizer
 *
 * Returns a stable, classified human-readable message suitable for client
 * HTTP responses. NEVER echoes any substring of the raw ClickHouse error
 * message — internal details (table/column names, version strings, parser
 * output) must not reach clients.
 *
 * The full original error continues to be logged server-side via
 * ErrorLogger.logError before this function is called at each action site.
 */

/**
 * Safe bucket messages returned to clients.
 * Exported so tests can assert against the exact constant strings.
 */
export const SANITIZED_MESSAGES = {
  NOT_FOUND: 'Resource not found',
  PERMISSION: 'Permission denied',
  TIMEOUT: 'Operation timed out',
  SYNTAX: 'Invalid query',
  GENERIC: 'Operation failed',
} as const

export type SanitizedMessage =
  (typeof SANITIZED_MESSAGES)[keyof typeof SANITIZED_MESSAGES]

/**
 * Classifies a raw ClickHouse error message and returns a safe client-facing
 * string. The raw message is NEVER included in the return value.
 *
 * @param raw - Raw error message from ClickHouse (logged server-side separately)
 * @returns A stable, classified message safe for client HTTP responses
 */
export function sanitizeClickHouseError(raw: string): SanitizedMessage {
  const lower = raw.toLowerCase()

  if (
    lower.includes('not found') ||
    lower.includes("doesn't exist") ||
    lower.includes('does not exist') ||
    lower.includes('unknown table') ||
    lower.includes('no such')
  ) {
    return SANITIZED_MESSAGES.NOT_FOUND
  }

  if (
    lower.includes('access denied') ||
    lower.includes('not enough privileges') ||
    lower.includes('permission denied') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return SANITIZED_MESSAGES.PERMISSION
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    return SANITIZED_MESSAGES.TIMEOUT
  }

  if (
    lower.includes('syntax') ||
    lower.includes('cannot parse') ||
    lower.includes('parse error') ||
    lower.includes('syntax error')
  ) {
    return SANITIZED_MESSAGES.SYNTAX
  }

  return SANITIZED_MESSAGES.GENERIC
}

/** Route-facing alias — import this instead of the error-handler barrel. */
export { sanitize[REDACTED]Error as sanitizeDbQueryError } // pragma: allowlist secret
