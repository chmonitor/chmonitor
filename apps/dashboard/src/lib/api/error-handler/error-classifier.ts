/**
 * Error Classifier
 *
 * Analyzes error objects and messages to determine appropriate error types
 * for consistent error handling across the API layer.
 */

import type { ErrorClassification } from './types'

import { ApiErrorType } from '@/lib/api/types'

/**
 * ClickHouse error codes / names mapped to API error types.
 *
 * ClickHouse messages carry `Code: <n>. DB::Exception: ... (<NAME>)`, and
 * the clients expose `.code` / `.type`. These are checked before any keyword
 * so a message that merely mentions "table" is not mistaken for a 404.
 */
const CLICKHOUSE_CODES: ReadonlyArray<{
  readonly type: ApiErrorType
  readonly codes: ReadonlyArray<number>
  readonly names: ReadonlyArray<string>
}> = [
  {
    type: ApiErrorType.TableNotFound,
    codes: [60],
    names: ['UNKNOWN_TABLE'],
  },
  {
    // A query referencing a column this server does not have is a query
    // problem (500), matching how such errors were classified before.
    type: ApiErrorType.QueryError,
    codes: [47],
    names: ['UNKNOWN_IDENTIFIER'],
  },
  {
    type: ApiErrorType.ValidationError,
    codes: [62],
    names: ['SYNTAX_ERROR'],
  },
  {
    type: ApiErrorType.PermissionError,
    codes: [497, 516],
    names: ['ACCESS_DENIED', 'AUTHENTICATION_FAILED'],
  },
  {
    type: ApiErrorType.TimeoutError,
    codes: [159],
    names: ['TIMEOUT_EXCEEDED'],
  },
]

/**
 * Keyword fallbacks for errors without a ClickHouse code, in priority order.
 * Only unambiguous phrases: bare words like "table" or "missing" are not
 * listed because they appear in unrelated errors.
 */
const CLASSIFICATION_PATTERNS: ReadonlyArray<{
  readonly type: ApiErrorType
  readonly keywords: ReadonlyArray<string>
}> = [
  {
    type: ApiErrorType.ValidationError,
    keywords: ['missing required parameter'],
  },
  {
    type: ApiErrorType.PermissionError,
    keywords: ['permission', 'access denied', 'unauthorized', 'forbidden'],
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

/** Table-not-found phrasing; only counts when the message names a table. */
const TABLE_MISSING_PHRASES: ReadonlyArray<string> = [
  "table doesn't exist",
  'table does not exist',
  'table not found',
  'unknown table',
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

  const codeType = classifyByClickHouseCode(error, message)
  if (codeType) {
    return { type: codeType, message }
  }

  if (
    matchesAnyKeyword(normalizedMessage, TABLE_MISSING_PHRASES) ||
    /table [^\s]+ (doesn't|does not) exist/.test(normalizedMessage)
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
 * Resolves an API error type from a ClickHouse error code or name, read from
 * the error's `code` / `type` fields or the `Code: <n>` / `(<NAME>)` parts of
 * the message.
 */
function classifyByClickHouseCode(
  error: unknown,
  message: string
): ApiErrorType | undefined {
  const codes = new Set<number>()
  const names = new Set<string>()

  if (error && typeof error === 'object') {
    const { code, type } = error as { code?: unknown; type?: unknown }
    const numeric = typeof code === 'string' ? Number(code) : code
    if (typeof numeric === 'number' && Number.isInteger(numeric)) {
      codes.add(numeric)
    }
    if (typeof type === 'string') names.add(type)
  }

  const codeMatch = /\bCode:\s*(\d+)/.exec(message)
  if (codeMatch) codes.add(Number(codeMatch[1]))
  for (const match of message.matchAll(/\(([A-Z][A-Z0-9_]+)\)/g)) {
    names.add(match[1])
  }

  if (codes.size === 0 && names.size === 0) return undefined

  for (const entry of CLICKHOUSE_CODES) {
    if (
      entry.codes.some((c) => codes.has(c)) ||
      entry.names.some((n) => names.has(n))
    ) {
      return entry.type
    }
  }
  return undefined
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
