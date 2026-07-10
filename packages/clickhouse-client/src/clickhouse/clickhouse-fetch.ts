/**
 * ClickHouse Data Fetching
 * Main fetchData function for executing queries with error handling
 */

import type { QueryParams } from '@clickhouse/client'

import type { QueryConfigLike } from '@chm/sql-builder'
import type { FetchDataErrorType, FetchDataResult } from './types'

import { getClickHouseVersion, selectVersionedSql } from '../clickhouse-version'
import { validateTableExistence } from '../table-validator'
import { transformClickHouseJsonEachRowWasmJson } from '../wasm/monitor-core'
import { getClient, releaseClient } from './clickhouse-client'
import { getClickHouseConfigs } from './clickhouse-config'
import { QUERY_COMMENT } from './constants'
import { debug, error, isDebugEnabled, warn } from '@chm/logger'

type FetchJsonEachRowTextResult = FetchDataResult<never> & {
  dataJson: string | null
}

/**
 * Parse `read_bytes` out of the `X-ClickHouse-Summary` response header (always
 * sent by the ClickHouse HTTP interface, regardless of format). Returns
 * `undefined` when the header is absent/unparseable — or when the result set
 * itself doesn't carry response_headers, e.g. in unit tests that stub a
 * minimal client — so callers only ever see a genuine value, never a guess.
 */
function parseReadBytesFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): number | undefined {
  const raw = headers?.['x-clickhouse-summary']
  const text = Array.isArray(raw) ? raw[0] : raw
  if (!text) return undefined

  try {
    const summary = JSON.parse(text) as { read_bytes?: string }
    const bytes = summary.read_bytes ? Number(summary.read_bytes) : undefined
    return bytes !== undefined && Number.isFinite(bytes) ? bytes : undefined
  } catch {
    return undefined
  }
}

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
function extractHttpStatusCode(errorMessage: string): number | undefined {
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
 * Fetch data from ClickHouse with comprehensive error handling
 */
export const fetchData = async <
  T extends
    | unknown[]
    | object[]
    | Record<string, unknown>
    | { length: number; rows: number; statistics: Record<string, unknown> },
>({
  query,
  query_params,
  format = 'JSONEachRow',
  clickhouse_settings,
  hostId,
  queryConfig,
  database,
}: QueryParams & {
  hostId: number | string
  clickhouse_settings?: QueryParams['clickhouse_settings'] & {
    /** IANA timezone for ClickHouse session (mapped to session_timezone) */
    session_timezone?: string
  }
  queryConfig?: QueryConfigLike
  /**
   * Optional default database for unqualified table names. Scopes a pooled
   * client per database; omit for the server's own default.
   */
  database?: string
}): Promise<FetchDataResult<T>> => {
  const start = new Date()

  // Parse and validate hostId to prevent NaN
  const currentHostId = Number(hostId)
  if (Number.isNaN(currentHostId)) {
    throw new Error(`Invalid hostId: ${hostId}. Must be a valid number.`)
  }

  const configs = getClickHouseConfigs()

  // Check if any configs are available
  if (configs.length === 0) {
    const errorMessage =
      'No ClickHouse hosts configured. Please set CLICKHOUSE_HOST environment variable.\n' +
      'Example: CLICKHOUSE_HOST=http://localhost:8123\n' +
      'See console logs for more details.'

    error('[fetchData] No ClickHouse configurations available!')
    error('[fetchData] Make sure environment variables are loaded.')
    error(
      '[fetchData] Check .env, .env.local, or deployment environment settings.'
    )

    return {
      data: null,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: {
        type: 'validation_error',
        message: errorMessage,
        details: {
          originalError: new Error(errorMessage),
          host: 'unknown',
        },
      },
    }
  }

  const clientConfig = configs[currentHostId]

  // Check if clientConfig exists before using it
  if (!clientConfig) {
    const availableHosts = configs.map((c) => c.id).join(', ')
    const errorMessage = `Invalid hostId: ${currentHostId}. Available hosts: ${availableHosts} (total: ${configs.length})`

    error('[fetchData]', errorMessage)

    return {
      data: null,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: {
        type: 'validation_error',
        message: errorMessage,
        details: {
          originalError: new Error(errorMessage),
          host: 'unknown',
        },
      },
    }
  }

  // When a default database is requested, scope the pooled client to it so
  // unqualified table names resolve against `database`. No-op otherwise, so
  // existing callers keep their exact pooling behavior.
  const effectiveConfig =
    database && database.length > 0
      ? { ...clientConfig, database }
      : clientConfig

  try {
    // Perform table validation if queryConfig is provided and query is optional
    if (queryConfig?.optional) {
      const validation = await validateTableExistence(
        queryConfig,
        currentHostId
      )

      if (!validation.shouldProceed) {
        const missingTables = validation.missingTables
        // A probe failure (network/timeout/auth) means table existence is
        // unknown, not confirmed missing — classify it as a network error so
        // the UI shows a connectivity/retry message instead of "table does
        // not exist" (issue #2505).
        const isProbeFailure = validation.reason === 'probe_failed'
        const errorMessage =
          validation.error ||
          `Missing required tables: ${missingTables.join(', ')}`

        warn(
          isProbeFailure
            ? `Skipping query "${queryConfig.name}" — could not verify table availability:`
            : `Skipping query "${queryConfig.name}" due to missing tables:`,
          isProbeFailure ? errorMessage : missingTables
        )

        return {
          data: null,
          metadata: {
            queryId: '',
            duration: 0,
            rows: 0,
            host: clientConfig.host,
          },
          error: {
            type: isProbeFailure ? 'network_error' : 'table_not_found',
            message: errorMessage,
            details: {
              missingTables,
              host: clientConfig.host,
            },
          },
        }
      }
    }

    // getClient() defaults to the web client (web !== false) — fetch()-based,
    // works on both Node/Docker and Cloudflare Workers. The node client is
    // stubbed out of this app's bundle, so no web flag is needed here.
    const client = await getClient({
      clientConfig: effectiveConfig,
    })

    try {
      // Select version-appropriate query
      let effectiveQuery = query
      // Only fetch version when needed (prevents infinite recursion since
      // getClickHouseVersion itself calls fetchData without queryConfig)
      let clickhouseVersion: Awaited<ReturnType<typeof getClickHouseVersion>> =
        null

      if (queryConfig) {
        // Get ClickHouse version for query selection
        clickhouseVersion = await getClickHouseVersion(currentHostId)

        // New format: sql is an array of VersionedSql
        if (Array.isArray(queryConfig.sql)) {
          effectiveQuery = selectVersionedSql(
            queryConfig.sql,
            clickhouseVersion
          )

          debug(
            `[fetchData] Version selection for ${queryConfig.name}: ` +
              `detected=${clickhouseVersion?.raw ?? 'null'}, ` +
              `selected=${effectiveQuery.substring(0, 60).replace(/\s+/g, ' ')}...`
          )
        }
        // Simple string sql
        else if (typeof queryConfig.sql === 'string') {
          effectiveQuery = queryConfig.sql
        }
      }

      const resultSet = await client.query({
        query: QUERY_COMMENT + effectiveQuery,
        format,
        query_params,
        clickhouse_settings,
      })

      const query_id = resultSet.query_id

      // Use the client's json() method which handles format-specific parsing
      const data = (await resultSet.json()) as T

      // Lazily serialize the parsed data — only needed for debug logging and the
      // rawResponse* metadata getters below, so avoid JSON.stringify in prod.
      let cachedRawText: string | undefined
      const getRawText = () => {
        if (cachedRawText === undefined) {
          cachedRawText = JSON.stringify(data)
        }
        return cachedRawText
      }

      // For debugging: serialize the parsed data to see what we got. Guarded so
      // the (potentially large) JSON.stringify never runs unless debug is on.
      if (isDebugEnabled()) {
        const rawText = getRawText()
        debug(`[fetchData] ClickHouse response (${query_id}):`, {
          dataType: typeof data,
          isArray: Array.isArray(data),
          length: Array.isArray(data) ? data.length : 'N/A',
          preview: rawText.substring(0, 500),
        })
      }

      const end = new Date()
      const duration = (end.getTime() - start.getTime()) / 1000
      let rows: number = 0

      debug(
        `--> Query (${query_id}, host: ${clientConfig.host}):`,
        effectiveQuery.replace(/(\n|\s+)/g, ' ').replace(/\s+/g, ' ')
      )

      if (data === null) {
        rows = -1
      } else if (Array.isArray(data)) {
        rows = data.length
      } else if (
        typeof data === 'object' &&
        Object.hasOwn(data, 'rows') &&
        Object.hasOwn(data, 'statistics')
      ) {
        rows = data.rows as number
      } else if (typeof data === 'object' && Object.hasOwn(data, 'rows')) {
        rows = data.rows as number
      }

      debug(`<-- Response (${query_id}):`, { rows, duration, unit: 's' })

      const metadata: Record<string, string | number> = {
        queryId: query_id,
        duration,
        rows,
        host: clientConfig.host,
        // Include detected ClickHouse version
        clickhouseVersion: clickhouseVersion?.raw ?? 'unknown',
        // Include the actual SQL that was executed (normalized for readability)
        sql: effectiveQuery.replace(/\s+/g, ' ').trim(),
      }

      // Only present when the X-ClickHouse-Summary header parses cleanly —
      // callers (e.g. OTel span attributes) must treat this as optional.
      const readBytes = parseReadBytesFromHeaders(resultSet.response_headers)
      if (readBytes !== undefined) {
        metadata.readBytes = readBytes
      }

      // Include raw response for debugging (lazily evaluated to avoid performance overhead)
      Object.defineProperties(metadata, {
        rawResponseLength: {
          get() {
            return getRawText().length
          },
          enumerable: true,
          configurable: true,
        },
        rawResponsePreview: {
          get() {
            const rawText = getRawText()
            return rawText.length <= 500
              ? rawText
              : `${rawText.substring(0, 500)}...`
          },
          enumerable: true,
          configurable: true,
        },
      })

      return { data, metadata }
    } finally {
      releaseClient({ clientConfig: effectiveConfig })
    }
  } catch (originalError) {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError)

    // Categorize error types based on error message patterns
    let errorType: FetchDataErrorType = 'query_error'

    // Extract HTTP status code from fetch errors
    const httpStatusCode = extractHttpStatusCode(errorMessage)

    // SSL/TLS errors (Cloudflare 525/526 as standalone status codes, not
    // digits embedded in larger numbers like "525.00 MiB" or "15251")
    if (
      /(?<![\d.])52[56](?!\d)(?!\.\d)/.test(errorMessage) ||
      errorMessage.toLowerCase().includes('ssl') ||
      errorMessage.toLowerCase().includes('tls') ||
      errorMessage.toLowerCase().includes('certificate') ||
      errorMessage.toLowerCase().includes('handshake')
    ) {
      errorType = 'ssl_error'
    }
    // Timeout errors
    else if (
      errorMessage.toLowerCase().includes('timeout') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('socket timeout')
    ) {
      errorType = 'timeout_error'
    }
    // Table not found errors
    else if (
      (errorMessage.toLowerCase().includes('table') &&
        errorMessage.toLowerCase().includes('not') &&
        errorMessage.toLowerCase().includes('exist')) ||
      errorMessage.toLowerCase().includes('unknown table')
    ) {
      errorType = 'table_not_found'
    }
    // Permission errors
    else if (
      errorMessage.toLowerCase().includes('permission') ||
      errorMessage.toLowerCase().includes('access')
    ) {
      errorType = 'permission_error'
    }
    // Network errors
    else if (
      errorMessage.toLowerCase().includes('network') ||
      errorMessage.toLowerCase().includes('connection') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('getaddrinfo') ||
      errorMessage.includes('socket hang up') ||
      errorMessage.includes('UND_ERR')
    ) {
      errorType = 'network_error'
    }

    const enrichedMessage = `${errorMessage} (host: ${clientConfig.host})`

    // Enhanced error logging with full details
    error(`Query failed (host: ${clientConfig.host}):`, errorMessage)
    error(`[Error Details]`, {
      errorType,
      httpStatusCode,
      host: clientConfig.host,
      stack: originalError instanceof Error ? originalError.stack : undefined,
      fullMessage: errorMessage,
    })

    // Log specific guidance for SSL errors
    if (errorType === 'ssl_error') {
      error(
        `[SSL Error Help] SSL/TLS handshake failed with ${clientConfig.host}. ` +
          `This usually means: ` +
          `1) The origin uses HTTP but you configured HTTPS, ` +
          `2) The origin has an invalid SSL certificate, ` +
          `3) The origin is behind Cloudflare Tunnel without proper SSL configuration. ` +
          `Try changing CLICKHOUSE_HOST to use HTTP (http://) instead of HTTPS (https://).`
      )
    }

    return {
      data: null,
      metadata: {
        queryId: '',
        duration: (Date.now() - start.getTime()) / 1000,
        rows: 0,
        host: clientConfig.host,
      },
      error: {
        type: errorType,
        message: enrichedMessage,
        details: {
          originalError:
            originalError instanceof Error ? originalError : undefined,
          host: clientConfig.host,
          httpStatusCode,
        },
      },
    }
  }
}

export const fetchJsonEachRowAsNormalizedJson = async ({
  query,
  query_params,
  clickhouse_settings,
  hostId,
  queryConfig,
}: QueryParams & {
  hostId: number | string
  clickhouse_settings?: QueryParams['clickhouse_settings'] & {
    /** IANA timezone for ClickHouse session (mapped to session_timezone) */
    session_timezone?: string
  }
  queryConfig?: QueryConfigLike
}): Promise<FetchJsonEachRowTextResult> => {
  const start = new Date()

  const currentHostId = Number(hostId)
  if (Number.isNaN(currentHostId)) {
    throw new Error(`Invalid hostId: ${hostId}. Must be a valid number.`)
  }

  const configs = getClickHouseConfigs()
  if (configs.length === 0) {
    const errorMessage =
      'No ClickHouse hosts configured. Please set CLICKHOUSE_HOST environment variable.\n' +
      'Example: CLICKHOUSE_HOST=http://localhost:8123\n' +
      'See console logs for more details.'

    error(
      '[fetchJsonEachRowAsNormalizedJson] No ClickHouse configurations available!'
    )

    return {
      data: null,
      dataJson: null,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: {
        type: 'validation_error',
        message: errorMessage,
        details: {
          originalError: new Error(errorMessage),
          host: 'unknown',
        },
      },
    }
  }

  const clientConfig = configs[currentHostId]
  if (!clientConfig) {
    const availableHosts = configs.map((c) => c.id).join(', ')
    const errorMessage = `Invalid hostId: ${currentHostId}. Available hosts: ${availableHosts} (total: ${configs.length})`

    error('[fetchJsonEachRowAsNormalizedJson]', errorMessage)

    return {
      data: null,
      dataJson: null,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: {
        type: 'validation_error',
        message: errorMessage,
        details: {
          originalError: new Error(errorMessage),
          host: 'unknown',
        },
      },
    }
  }

  try {
    if (queryConfig?.optional) {
      const validation = await validateTableExistence(
        queryConfig,
        currentHostId
      )

      if (!validation.shouldProceed) {
        const missingTables = validation.missingTables
        const errorMessage =
          validation.error ||
          `Missing required tables: ${missingTables.join(', ')}`

        warn(
          `Skipping query "${queryConfig.name}" due to missing tables:`,
          missingTables
        )

        return {
          data: null,
          dataJson: null,
          metadata: {
            queryId: '',
            duration: 0,
            rows: 0,
            host: clientConfig.host,
          },
          error: {
            type: 'table_not_found',
            message: errorMessage,
            details: {
              missingTables,
              host: clientConfig.host,
            },
          },
        }
      }
    }

    const client = await getClient({
      clientConfig,
    })

    // Select the version-appropriate SQL when a versioned queryConfig is
    // provided, mirroring fetchData. Current callers pre-resolve the SQL and
    // pass only a minimal queryConfig (for the optional-table check), so this
    // is a no-op for them; it makes the helper correct for any caller that
    // hands over a queryConfig with a versioned sql[] instead.
    let effectiveQuery = query
    if (queryConfig && Array.isArray(queryConfig.sql)) {
      const clickhouseVersion = await getClickHouseVersion(currentHostId)
      effectiveQuery = selectVersionedSql(queryConfig.sql, clickhouseVersion)
      debug(
        `[fetchJsonEachRowAsNormalizedJson] Version selection for ${queryConfig.name}: ` +
          `detected=${clickhouseVersion?.raw ?? 'null'}`
      )
    }

    try {
      const resultSet = await client.query({
        query: QUERY_COMMENT + effectiveQuery,
        format: 'JSONEachRow',
        query_params,
        clickhouse_settings,
      })

      const queryId = resultSet.query_id
      const rawText = await resultSet.text()
      const dataJson = await transformClickHouseJsonEachRowWasmJson(rawText)
      const duration = (Date.now() - start.getTime()) / 1000
      const rows = countJsonEachRowRows(rawText)

      debug(
        `--> Query (${queryId}, host: ${clientConfig.host}):`,
        effectiveQuery.replace(/(\n|\s+)/g, ' ').replace(/\s+/g, ' ')
      )
      debug(`<-- Response (${queryId}):`, { rows, duration, unit: 's' })

      // Only present when the X-ClickHouse-Summary header parses cleanly —
      // callers (e.g. OTel span attributes) must treat this as optional.
      const readBytes = parseReadBytesFromHeaders(resultSet.response_headers)

      return {
        data: null,
        dataJson,
        metadata: {
          queryId,
          duration,
          rows,
          host: clientConfig.host,
          sql: effectiveQuery.replace(/\s+/g, ' ').trim(),
          rawResponseLength: rawText.length,
          rawResponsePreview:
            rawText.length <= 500 ? rawText : `${rawText.substring(0, 500)}...`,
          ...(readBytes !== undefined ? { readBytes } : {}),
        },
      }
    } finally {
      releaseClient({ clientConfig })
    }
  } catch (originalError) {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError)

    let errorType: FetchDataErrorType = 'query_error'

    // Extract HTTP status code from fetch errors
    const httpStatusCode = extractHttpStatusCode(errorMessage)

    // SSL/TLS errors (Cloudflare 525/526 as standalone status codes, not
    // digits embedded in larger numbers like "525.00 MiB" or "15251")
    if (
      /(?<![\d.])52[56](?!\d)(?!\.\d)/.test(errorMessage) ||
      errorMessage.toLowerCase().includes('ssl') ||
      errorMessage.toLowerCase().includes('tls') ||
      errorMessage.toLowerCase().includes('certificate') ||
      errorMessage.toLowerCase().includes('handshake')
    ) {
      errorType = 'ssl_error'
    }
    // Timeout errors
    else if (
      errorMessage.toLowerCase().includes('timeout') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('socket timeout')
    ) {
      errorType = 'timeout_error'
    }
    // Table not found errors
    else if (
      (errorMessage.toLowerCase().includes('table') &&
        errorMessage.toLowerCase().includes('not') &&
        errorMessage.toLowerCase().includes('exist')) ||
      errorMessage.toLowerCase().includes('unknown table')
    ) {
      errorType = 'table_not_found'
    }
    // Permission errors
    else if (
      errorMessage.toLowerCase().includes('permission') ||
      errorMessage.toLowerCase().includes('access')
    ) {
      errorType = 'permission_error'
    }
    // Network errors
    else if (
      errorMessage.toLowerCase().includes('network') ||
      errorMessage.toLowerCase().includes('connection') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('getaddrinfo') ||
      errorMessage.includes('socket hang up') ||
      errorMessage.includes('UND_ERR')
    ) {
      errorType = 'network_error'
    }

    const enrichedMessage = `${errorMessage} (host: ${clientConfig.host})`

    // Enhanced error logging with full details
    error(`Query failed (host: ${clientConfig.host}):`, errorMessage)
    error(`[Error Details]`, {
      errorType,
      httpStatusCode,
      host: clientConfig.host,
      stack: originalError instanceof Error ? originalError.stack : undefined,
      fullMessage: errorMessage,
    })

    // Log specific guidance for SSL errors
    if (errorType === 'ssl_error') {
      error(
        `[SSL Error Help] SSL/TLS handshake failed with ${clientConfig.host}. ` +
          `This usually means: ` +
          `1) The origin uses HTTP but you configured HTTPS, ` +
          `2) The origin has an invalid SSL certificate, ` +
          `3) The origin is behind Cloudflare Tunnel without proper SSL configuration. ` +
          `Try changing CLICKHOUSE_HOST to use HTTP (http://) instead of HTTPS (https://).`
      )
    }

    return {
      data: null,
      dataJson: null,
      metadata: {
        queryId: '',
        duration: (Date.now() - start.getTime()) / 1000,
        rows: 0,
        host: clientConfig.host,
      },
      error: {
        type: errorType,
        message: enrichedMessage,
        details: {
          originalError:
            originalError instanceof Error ? originalError : undefined,
          host: clientConfig.host,
          httpStatusCode,
        },
      },
    }
  }
}

function countJsonEachRowRows(input: string): number {
  let rows = 0
  let hasContent = false

  for (let index = 0; index < input.length; index += 1) {
    const ch = input.charCodeAt(index)
    if (ch === 10) {
      if (hasContent) {
        rows += 1
        hasContent = false
      }
    } else if (ch !== 13 && ch !== 32 && ch !== 9) {
      hasContent = true
    }
  }

  if (hasContent) {
    rows += 1
  }

  return rows
}

export function __testCountJsonEachRowRows(input: string): number {
  return countJsonEachRowRows(input)
}
