import type { FetchDataErrorType, FetchDataResult } from './types'

import { error } from '@chm/logger'

/**
 * Extract an HTTP status code (100–599) from a fetch error message.
 *
 * Strategy:
 * 1. Try a keyword-anchored match that handles:
 *    - "status: 500", "HTTP status 403", "HTTP error 502"
 *    - Standard HTTP status lines: "HTTP/1.1 500", "HTTP/2 502"
 * 2. If (1) fails AND the message has ClickHouse wording (a "Code:" clause,
 *    "Syntax error", "position N", "line N"), skip the generic digit scan to
 *    avoid misidentifying internal error codes and parser positions.
 * 3. Otherwise fall back to a generic 3-digit match.
 */
const CLICKHOUSE_WORDING =
  /\bCode:|DB::Exception|Syntax error|\bposition\s+\d+|\bline\s+\d+/i

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

  // Skip generic digit scan when the message is ClickHouse wording and no HTTP
  // keyword was found above: internal codes ("Code: 210") and parser
  // locations ("failed at position 514", "line 3, col 120") are not statuses.
  if (CLICKHOUSE_WORDING.test(errorMessage)) {
    return undefined
  }

  const genericMatch = errorMessage.match(/\b([1-5]\d{2})\b/)
  if (genericMatch) {
    return parseInt(genericMatch[1], 10)
  }

  return undefined
}

/** ClickHouse error types that map to a specific category. */
const CLICKHOUSE_ERROR_TYPES: Readonly<Record<string, FetchDataErrorType>> = {
  UNKNOWN_TABLE: 'table_not_found',
  UNKNOWN_DATABASE: 'table_not_found',
  ACCESS_DENIED: 'permission_error',
  AUTHENTICATION_FAILED: 'permission_error',
  TIMEOUT_EXCEEDED: 'timeout_error',
  SOCKET_TIMEOUT: 'timeout_error',
  NETWORK_ERROR: 'network_error',
  ALL_CONNECTION_TRIES_FAILED: 'network_error',
}

// Same shape as the client's own parser: the greedy `.*Exception: ` lands on
// the innermost exception of a cluster-wrapped error.
const RAW_CLICKHOUSE_ERROR =
  /(?:Code|Error): \d+[\s\S]*Exception: [\s\S]+?\(([A-Z0-9_]*[A-Z]{3}[A-Z0-9_]*)\)/

/**
 * The ClickHouse error type (e.g. `ACCESS_DENIED`) of a thrown error, read from
 * the client's `ClickHouseError.type` or, for unparsed text, from the raw
 * `Code: N. DB::Exception: ... (TYPE)` message.
 */
export function clickHouseErrorType(err: unknown): string | undefined {
  if (err instanceof Error && 'type' in err && typeof err.type === 'string') {
    return err.type
  }
  const message = err instanceof Error ? err.message : String(err)
  return message.match(RAW_CLICKHOUSE_ERROR)?.[1]
}

/**
 * `merge('system', '^error_log')` on a server that never created the log
 * table fails with code 636 instead of 60. The same code also covers failed
 * schema inference (s3, file, url), so the message decides.
 */
function isNoTablesMatchRegexpError(
  errorMessage: string,
  clickHouseType: string
): boolean {
  return (
    clickHouseType === 'CANNOT_EXTRACT_TABLE_STRUCTURE' &&
    errorMessage.includes('no tables satisfied provided regexp')
  )
}

/**
 * Categorize an error into a `FetchDataErrorType`. A ClickHouse server error
 * is classified by its error type alone: its message text names user
 * identifiers (`access_type`, `system.certificates`) that the substring
 * heuristics below would misread. Other errors (network, proxy, TLS) fall
 * back to those heuristics, where the first matching category wins.
 */
export function classifyFetchError(
  errorMessage: string,
  clickHouseType?: string
): FetchDataErrorType {
  if (clickHouseType) {
    if (isNoTablesMatchRegexpError(errorMessage, clickHouseType)) {
      return 'table_not_found'
    }
    return CLICKHOUSE_ERROR_TYPES[clickHouseType] ?? 'query_error'
  }
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
  if (
    errorMessage.toLowerCase().includes('timeout') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('socket timeout')
  ) {
    return 'timeout_error'
  }
  if (
    (errorMessage.toLowerCase().includes('table') &&
      errorMessage.toLowerCase().includes('not') &&
      errorMessage.toLowerCase().includes('exist')) ||
    errorMessage.toLowerCase().includes('unknown table')
  ) {
    return 'table_not_found'
  }
  if (
    errorMessage.toLowerCase().includes('permission') ||
    errorMessage.toLowerCase().includes('access') ||
    // ClickHouse ACCESS_DENIED (code 497): "Not enough privileges. To execute
    // this query, it's necessary to have the grant SELECT ... ON system.x"
    errorMessage.toLowerCase().includes('not enough privileges')
  ) {
    return 'permission_error'
  }
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

  const errorType = classifyFetchError(
    errorMessage,
    clickHouseErrorType(originalError)
  )

  const httpStatusCode = extractHttpStatusCode(errorMessage)

  const enrichedMessage = `${errorMessage} (host: ${host})`

  error(`Query failed (host: ${host}):`, errorMessage)
  error(`[Error Details]`, {
    errorType,
    httpStatusCode,
    host,
    stack: originalError instanceof Error ? originalError.stack : undefined,
    fullMessage: errorMessage,
  })

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
