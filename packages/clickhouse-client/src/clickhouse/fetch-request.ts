/**
 * Request-preparation seams of the fetch funnel: host/config resolution,
 * optional-table validation, and version-aware SQL selection.
 *
 * Extracted from `clickhouse-fetch.ts` — behaviour is unchanged, including the
 * exact log calls each entrypoint made before the split.
 */

import type { QueryConfigLike } from '@chm/sql-builder'
import type { ClickHouseConfig, FetchDataResult } from './types'

import { getClickHouseVersion, selectVersionedSql } from '../clickhouse-version'
import { validateTableExistence } from '../table-validator'
import { getClickHouseConfigs } from './clickhouse-config'
import { debug, error, warn } from '@chm/logger'

type ErrorHalf = Pick<FetchDataResult<never>, 'metadata' | 'error'>

export type HostResolution =
  | { ok: true; clientConfig: ClickHouseConfig }
  | { ok: false; failure: ErrorHalf }

/**
 * Validate `hostId` and resolve it to a configured ClickHouse host.
 *
 * Throws (rather than returning a failure) for a non-numeric `hostId`, matching
 * the original behaviour of both entrypoints.
 */
export function resolveHostConfig(
  hostId: number | string,
  {
    label,
    extraNoConfigLogs = [],
  }: { label: string; extraNoConfigLogs?: string[] }
): HostResolution & { currentHostId: number } {
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

    error(`${label} No ClickHouse configurations available!`)
    for (const line of extraNoConfigLogs) {
      error(line)
    }

    return {
      ok: false,
      currentHostId,
      failure: unknownHostFailure(errorMessage),
    }
  }

  const clientConfig = configs[currentHostId]

  // Check if clientConfig exists before using it
  if (!clientConfig) {
    const availableHosts = configs.map((c) => c.id).join(', ')
    const errorMessage = `Invalid hostId: ${currentHostId}. Available hosts: ${availableHosts} (total: ${configs.length})`

    error(label, errorMessage)

    return {
      ok: false,
      currentHostId,
      failure: unknownHostFailure(errorMessage),
    }
  }

  return { ok: true, currentHostId, clientConfig }
}

function unknownHostFailure(errorMessage: string): ErrorHalf {
  return {
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

/**
 * Run the optional-table existence check for a queryConfig marked `optional`.
 * Returns the error half of the result when the query must be skipped, or
 * `null` when it should proceed (including when no check applies).
 *
 * `classifyProbeFailure` reproduces `fetchData`'s #2505 behaviour: a probe
 * failure (network/timeout/auth) means table existence is unknown, not
 * confirmed missing, so it is reported as a network error.
 */
export async function checkOptionalTables({
  queryConfig,
  currentHostId,
  host,
  classifyProbeFailure,
}: {
  queryConfig: QueryConfigLike | undefined
  currentHostId: number
  host: string
  classifyProbeFailure: boolean
}): Promise<ErrorHalf | null> {
  if (!queryConfig?.optional) return null

  const validation = await validateTableExistence(queryConfig, currentHostId)
  if (validation.shouldProceed) return null

  const missingTables = validation.missingTables
  const isProbeFailure =
    classifyProbeFailure && validation.reason === 'probe_failed'
  const errorMessage =
    validation.error || `Missing required tables: ${missingTables.join(', ')}`

  if (isProbeFailure) {
    warn(
      `Skipping query "${queryConfig.name}" — could not verify table availability:`,
      errorMessage
    )
  } else {
    warn(
      `Skipping query "${queryConfig.name}" due to missing tables:`,
      missingTables
    )
  }

  return {
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host,
    },
    error: {
      type: isProbeFailure ? 'network_error' : 'table_not_found',
      message: errorMessage,
      details: {
        missingTables,
        host,
      },
    },
  }
}

/**
 * Pick the version-appropriate SQL for a queryConfig. The ClickHouse version is
 * only fetched when a queryConfig is supplied, preventing infinite recursion
 * (getClickHouseVersion itself calls fetchData without a queryConfig).
 */
export async function resolveEffectiveQuery({
  query,
  queryConfig,
  currentHostId,
}: {
  query: string
  queryConfig: QueryConfigLike | undefined
  currentHostId: number
}): Promise<{
  effectiveQuery: string
  clickhouseVersion: Awaited<ReturnType<typeof getClickHouseVersion>>
}> {
  let effectiveQuery = query
  let clickhouseVersion: Awaited<ReturnType<typeof getClickHouseVersion>> = null

  if (queryConfig) {
    // Get ClickHouse version for query selection
    clickhouseVersion = await getClickHouseVersion(currentHostId)

    // New format: sql is an array of VersionedSql
    if (Array.isArray(queryConfig.sql)) {
      effectiveQuery = selectVersionedSql(queryConfig.sql, clickhouseVersion)

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

  return { effectiveQuery, clickhouseVersion }
}
