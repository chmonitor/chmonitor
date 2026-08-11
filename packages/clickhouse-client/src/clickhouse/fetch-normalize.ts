/**
 * JSONEachRow → normalized-JSON fetching.
 *
 * Extracted from `clickhouse-fetch.ts` (which re-exports
 * `fetchJsonEachRowAsNormalizedJson` unchanged). Streams the raw JSONEachRow
 * text through the WASM normalizer instead of parsing it in JS.
 */

import type { QueryParams } from '@clickhouse/client'

import type { QueryConfigLike } from '@chm/sql-builder'
import type { FetchDataResult } from './types'

import { getClickHouseVersion, selectVersionedSql } from '../clickhouse-version'
import { transformClickHouseJsonEachRowWasmJson } from '../wasm/monitor-core'
import { getClient, releaseClient } from './clickhouse-client'
import { QUERY_COMMENT } from './constants'
import { handleFetchError } from './fetch-errors'
import {
  countJsonEachRowRows,
  parseReadBytesFromHeaders,
} from './fetch-headers'
import { checkOptionalTables, resolveHostConfig } from './fetch-request'
import { debug } from '@chm/logger'

export type FetchJsonEachRowTextResult = FetchDataResult<never> & {
  dataJson: string | null
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

  const resolved = resolveHostConfig(hostId, {
    label: '[fetchJsonEachRowAsNormalizedJson]',
  })
  if (!resolved.ok) {
    return { data: null, dataJson: null, ...resolved.failure }
  }

  const { clientConfig, currentHostId } = resolved

  try {
    const skipped = await checkOptionalTables({
      queryConfig,
      currentHostId,
      host: clientConfig.host,
      classifyProbeFailure: false,
    })
    if (skipped) {
      return { data: null, dataJson: null, ...skipped }
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
    return {
      data: null,
      dataJson: null,
      ...handleFetchError({
        originalError,
        host: clientConfig.host,
        start,
      }),
    }
  }
}
