/**
 * Error classification and error-result construction for the fetch funnel.
 *
 * Extracted from `clickhouse-fetch.ts`. `classifyFetchError` and
 * `extractHttpStatusCode` are pure; `handleFetchError` additionally performs
 * the (unchanged) error logging both fetch entrypoints share.
 */

import type { FetchDataErrorType, FetchDataResult } from './types'

import { error } from '@chm/logger'

/**
 * Extract an HTTP status code (100–599) from a fetch error message.
 *
 * Strategy:
 * 1. Try a keyword-anchored match that handles:
 *    - "status: 500", "HTTP status 403", "HTTP error 502"
 *    - Standard HTTP status lines: "HTTP/1.1 500", "HTTP/2 502"
 * 2. If (1) fails AND the message also contains a ClickHouse "Code:" clause
 *    that sits at the start of a line or is unaccompanied by HTTP keywords,
 *    skip the generic digit scan to avoid misidentifying internal error codes.
 * 3. Otherwise fall back to a generic 3-digit match.
 */
export function extractHttpStatusCode(
  errorMessage: string
): number | undefined {
  // Keyword-anchored: matches "status 500", "HTTP status 403", "HTTP/1.1 500", "HTTP/2 502", etc.
  const keywordMatch = errorMessage.match(
    /\b(?:status|HTTP(?:\/\d+(?:\.\d+)?)?(?:\s+(?:status|error))?)\s*([1-5]\d{2})\b/i
  )
  if (keywordMatch) {
    return parseInt(keywordMatch[1], 10)
  }

  // Skip generic digit scan when ClickHouse internal codes are present and no
  // HTTP keyword was found above, to avoid false positives like "Code: 210".
  if (errorMessage.includes('Code:')) {
    return undefined
  }

  const genericMatch = errorMessage.match(/\b([1-5]\d{2})\b/)
  if (genericMatch) {
    return parseInt(genericMatch[1], 10)
  }

  return undefined
}

/**
 * Categorize an error message into a `FetchDataErrorType`. Order matters — the
 * first matching category wins, mirroring the original if/else chain.
 */
export function classifyFetchError(errorMessage: string): FetchDataErrorType {
  // SSL/TLS errors (Cloudflare 525/526 as standalone status codes, not
  // digits embedded in larger numbers like "525.00 MiB" or "15251")
  if (
    /(?<![\d.])52[56](?!\d)(?!\.\d)/.test(errorMessage) ||
    errorMessage.toLowerCase().includes('ssl') ||
    errorMessage.toLowerCase().includes('tls') ||
    errorMessage.toLowerCase().includes('certificate') ||
    errorMessage.toLowerCase().includes('handshake')
  ) {
    return 'ssl_error'
  }
  // Timeout errors
  if (
    errorMessage.toLowerCase().includes('timeout') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('socket timeout')
  ) {
    return 'timeout_error'
  }
  // Table not found errors
  if (
    (errorMessage.toLowerCase().includes('table') &&
      errorMessage.toLowerCase().includes('not') &&
      errorMessage.toLowerCase().includes('exist')) ||
    errorMessage.toLowerCase().includes('unknown table')
  ) {
    return 'table_not_found'
  }
  // Permission errors
  if (
    errorMessage.toLowerCase().includes('permission') ||
    errorMessage.toLowerCase().includes('access')
  ) {
    return 'permission_error'
  }
  // Network errors
  if (
    errorMessage.toLowerCase().includes('network') ||
    errorMessage.toLowerCase().includes('connection') ||
    errorMessage.includes('fetch failed') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('getaddrinfo') ||
    errorMessage.includes('socket hang up') ||
    errorMessage.includes('UND_ERR')
  ) {
    return 'network_error'
  }

  return 'query_error'
}

/**
 * Classify, log and shape a thrown query error into the `{ metadata, error }`
 * half of a `FetchDataResult`. Both fetch entrypoints share this body; the
 * caller adds `data: null` (and `dataJson: null` where applicable).
 */
export function handleFetchError({
  originalError,
  host,
  start,
}: {
  originalError: unknown
  host: string
  start: Date
}): Pick<FetchDataResult<never>, 'metadata' | 'error'> {
  const errorMessage =
    originalError instanceof Error
      ? originalError.message
      : String(originalError)

  // Categorize error types based on error message patterns
  const errorType = classifyFetchError(errorMessage)

  // Extract HTTP status code from fetch errors
  const httpStatusCode = extractHttpStatusCode(errorMessage)

  const enrichedMessage = `${errorMessage} (host: ${host})`

  // Enhanced error logging with full details
  error(`Query failed (host: ${host}):`, errorMessage)
  error(`[Error Details]`, {
    errorType,
    httpStatusCode,
    host,
    stack: originalError instanceof Error ? originalError.stack : undefined,
    fullMessage: errorMessage,
  })

  // Log specific guidance for SSL errors
  if (errorType === 'ssl_error') {
    error(
      `[SSL Error Help] SSL/TLS handshake failed with ${host}. ` +
        `This usually means: ` +
        `1) The origin uses HTTP but you configured HTTPS, ` +
        `2) The origin has an invalid SSL certificate, ` +
        `3) The origin is behind Cloudflare Tunnel without proper SSL configuration. ` +
        `Try changing CLICKHOUSE_HOST to use HTTP (http://) instead of HTTPS (https://).`
    )
  }

  return {
    metadata: {
      queryId: '',
      duration: (Date.now() - start.getTime()) / 1000,
      rows: 0,
      host,
    },
    error: {
      type: errorType,
      message: enrichedMessage,
      details: {
        originalError:
          originalError instanceof Error ? originalError : undefined,
        host,
        httpStatusCode,
      },
    },
  }
}
