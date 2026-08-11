/**
 * ClickHouse Data Fetching
 * Main fetchData function for executing queries with error handling
 *
 * The pieces of the funnel live in sibling modules so they can be tested in
 * isolation:
 * - `fetch-headers.ts` — response-header / JSONEachRow parsers (pure)
 * - `fetch-request.ts` — host resolution, optional-table check, versioned SQL
 * - `fetch-errors.ts` — error classification, logging, error-result shape
 * - `fetch-normalize.ts` — `fetchJsonEachRowAsNormalizedJson`
 */

import type { QueryParams } from '@clickhouse/client'

import type { QueryConfigLike } from '@chm/sql-builder'
import type { FetchDataResult } from './types'

import { getClient, releaseClient } from './clickhouse-client'
import { QUERY_COMMENT } from './constants'
import { handleFetchError } from './fetch-errors'
import {
  parseReadBytesFromHeaders,
  parseRowsBeforeLimitFromHeaders,
} from './fetch-headers'
import {
  checkOptionalTables,
  resolveEffectiveQuery,
  resolveHostConfig,
} from './fetch-request'
import { debug, isDebugEnabled } from '@chm/logger'

export type { FetchJsonEachRowTextResult } from './fetch-normalize'

export { fetchJsonEachRowAsNormalizedJson } from './fetch-normalize'

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

  const resolved = resolveHostConfig(hostId, {
    label: '[fetchData]',
    extraNoConfigLogs: [
      '[fetchData] Make sure environment variables are loaded.',
      '[fetchData] Check .env, .env.local, or deployment environment settings.',
    ],
  })
  if (!resolved.ok) {
    return { data: null, ...resolved.failure }
  }

  const { clientConfig, currentHostId } = resolved

  // When a default database is requested, scope the pooled client to it so
  // unqualified table names resolve against `database`. No-op otherwise, so
  // existing callers keep their exact pooling behavior.
  const effectiveConfig =
    database && database.length > 0
      ? { ...clientConfig, database }
      : clientConfig

  try {
    // Perform table validation if queryConfig is provided and query is optional
    const skipped = await checkOptionalTables({
      queryConfig,
      currentHostId,
      host: clientConfig.host,
      classifyProbeFailure: true,
    })
    if (skipped) {
      return { data: null, ...skipped }
    }

    // getClient() defaults to the web client (web !== false) — fetch()-based,
    // works on both Node/Docker and Cloudflare Workers. The node client is
    // stubbed out of this app's bundle, so no web flag is needed here.
    const client = await getClient({
      clientConfig: effectiveConfig,
    })

    try {
      // Select version-appropriate query
      const { effectiveQuery, clickhouseVersion } = await resolveEffectiveQuery(
        { query, queryConfig, currentHostId }
      )

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

      // Only present when result_overflow_mode='break' (or a plain LIMIT)
      // truncated the query — lets callers detect and surface truncation
      // (#2490).
      const rowsBeforeLimitAtLeast = parseRowsBeforeLimitFromHeaders(
        resultSet.response_headers
      )
      if (rowsBeforeLimitAtLeast !== undefined) {
        metadata.rows_before_limit_at_least = rowsBeforeLimitAtLeast
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
    return {
      data: null,
      ...handleFetchError({
        originalError,
        host: clientConfig.host,
        start,
      }),
    }
  }
}
