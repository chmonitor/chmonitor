import type { FetchDataResult } from '@chm/clickhouse-client'
import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import type { VersionedSql } from '@chm/sql-builder'
import type { ClickHouseBindings } from '@/lib/api/server-env'
import type { QueryConfig } from '@/lib/query-config'
import type { ChartQuerySettings } from '@/types/chart-data'

import {
  fetchData,
  fetchJsonEachRowAsNormalizedJson,
  getClient,
} from '@chm/clickhouse-client'
import {
  getClickHouseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'
import { error } from '@chm/logger'
import { runWithQueryCache } from '@/lib/api/query-cache-settings'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'
import {
  getTableClickHouseSettings,
  resolveTableResultRowLimit,
} from '@/lib/api/table-query-settings'
import { withClickHouseQuerySpan } from '@/lib/otel/query-span'
import { getSqlForDisplay } from '@/lib/query-config'

const QUERY_PARAM_PLACEHOLDER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:[^{}]+\}/g

export function findMissingQueryParams(
  sql: string,
  params: Record<string, unknown> | undefined
): string[] {
  const missing = new Set<string>()
  for (const [, name] of sql.matchAll(QUERY_PARAM_PLACEHOLDER)) {
    if (params?.[name] === undefined || params[name] === null) {
      missing.add(name)
    }
  }
  return [...missing]
}

const DEFAULT_TABLE_CACHE_TTL_SECONDS = 30
const MIN_CACHE_TTL_SECONDS = 5
const MAX_CACHE_TTL_SECONDS = 300

/**
 * Table configs already carry `refreshInterval` (ms) as their client-side
 * poll cadence — reuse it as the query-cache TTL so cached results never
 * outlive the UI's own refresh rate, clamped to a sane range.
 */
function tableCacheTtlSeconds(refreshIntervalMs?: number): number {
  if (!refreshIntervalMs || refreshIntervalMs <= 0) {
    return DEFAULT_TABLE_CACHE_TTL_SECONDS
  }
  const seconds = Math.round(refreshIntervalMs / 1000)
  return Math.min(
    Math.max(seconds, MIN_CACHE_TTL_SECONDS),
    MAX_CACHE_TTL_SECONDS
  )
}

/**
 * Interval allowlist for time-bucketing charts. Inlined (not imported from
 * @chm/types, which is not aliased in this app's tsconfig) so the executor
 * can validate the `interval` query param against SQL injection. Mirrors
 * @chm/types/clickhouse-interval VALID_INTERVALS.
 */
export const VALID_INTERVALS = [
  'toStartOfMinute',
  'toStartOfFiveMinutes',
  'toStartOfTenMinutes',
  'toStartOfFifteenMinutes',
  'toStartOfHour',
  'toStartOfDay',
  'toStartOfWeek',
  'toStartOfMonth',
] as const

export type ClickHouseInterval = (typeof VALID_INTERVALS)[number]

export function isValidInterval(value: string): value is ClickHouseInterval {
  return (VALID_INTERVALS as readonly string[]).includes(value)
}

function toNumericHostId(hostId: number | string): number {
  const n = parseHostIdParam(hostId)
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid hostId: ${String(hostId)}. Must be a number.`)
  }
  return n
}

/**
 * Pick the SQL string to execute for the current CH version.
 * Priority: VersionedSql[] (`sql`) → plain string (`sql`). The deprecated
 * `variants` form is not handled here (port it if a ported config needs it).
 *
 * Always resolves the ClickHouse version (cached 24h per host by
 * getClickHouseVersion — see clickhouse-version.ts), even for plain-string
 * SQL: query-cache settings (#2182) must be gated on it, since sending
 * `use_query_cache` to a pre-23.5 host throws "Unknown setting" and fails
 * the query outright.
 */
async function selectSqlForHost(
  sql: string | VersionedSql[],
  numericHostId: number
): Promise<{
  sql: string
  version: string | undefined
  clickhouseVersion: ClickHouseVersion | null
}> {
  const clickhouseVersion = await getClickHouseVersion(numericHostId)
  const selectedSql =
    typeof sql === 'string' ? sql : selectVersionedSql(sql, clickhouseVersion)
  return {
    sql: selectedSql,
    version: clickhouseVersion?.raw,
    clickhouseVersion,
  }
}

export interface ExecuteOptions {
  bindings?: ClickHouseBindings
  timezone?: string
}

export interface ExecuteTableResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  result: FetchDataResult<T[]>
  executedSql: string
  clickhouseVersion?: string
  maxResultRows: number
}

export async function executeTableConfig<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  queryConfig: QueryConfig,
  hostId: number | string,
  queryParams: Record<string, unknown> | undefined,
  options: ExecuteOptions = {}
): Promise<ExecuteTableResult<T>> {
  if (options.bindings) bridgeClickHouseEnv(options.bindings)

  const numericHostId = toNumericHostId(hostId)
  const {
    sql: executedSql,
    version,
    clickhouseVersion,
  } = await selectSqlForHost(queryConfig.sql, numericHostId)

  // A `{name:Type}` placeholder with no value is the caller's mistake (#3918):
  // answer validation_error (400) instead of ClickHouse's 500
  // UNKNOWN_QUERY_PARAMETER.
  const missingParams = findMissingQueryParams(executedSql, queryParams)
  if (missingParams.length > 0) {
    return {
      result: {
        data: null,
        metadata: {},
        error: {
          type: 'validation_error',
          message: `Missing required parameter(s): ${missingParams.join(', ')}`,
        },
      },
      executedSql,
      clickhouseVersion: version,
      maxResultRows: 0,
    }
  }

  // Server-side row cap (#2490): stop ClickHouse from shipping unbounded
  // result sets for `SELECT *`-style table configs. `result_overflow_mode:
  // 'break'` makes the server truncate instead of erroring, and the
  // `X-ClickHouse-Summary` response header then reports
  // `rows_before_limit_at_least` so the route can detect truncation.
  // `getTableClickHouseSettings` respects a config's own `max_result_rows`
  // (as long as it doesn't exceed the cap) and is spread last below so it
  // wins over the query-cache settings for any overlapping keys.
  const maxResultRows = resolveTableResultRowLimit()
  const tableSettings = getTableClickHouseSettings(
    queryConfig,
    options.timezone,
    maxResultRows,
    clickhouseVersion
  )

  // ClickHouse rejects `use_query_cache` combined with a non-'throw'
  // `result_overflow_mode` (error 731,
  // QUERY_CACHE_USED_WITH_NON_THROW_OVERFLOW_MODE) — and the row cap above
  // sets `result_overflow_mode: 'break'` whenever it's active, which fails
  // EVERY capped table query outright once the query cache (#2182) is also
  // enabled (e.g. history-queries). The row cap wins: skip the query cache
  // for any query where a non-throw overflow mode is in effect.
  const overflowModeBlocksCache =
    tableSettings.result_overflow_mode !== undefined &&
    tableSettings.result_overflow_mode !== 'throw'

  // Read-only GET path (routes/api/v1/tables/$name.ts, explorer/*): safe to
  // opt into the ClickHouse query cache (#2182). `queryConfig.clickhouseSettings`
  // is spread after so a config can still override any of these explicitly.
  const result = await withClickHouseQuerySpan(() =>
    runWithQueryCache(
      {
        version: clickhouseVersion,
        ttlSeconds: tableCacheTtlSeconds(queryConfig.refreshInterval),
        disabled: queryConfig.disableQueryCache || overflowModeBlocksCache,
        hostId,
      },
      (cache) =>
        fetchData<T[]>({
          query: executedSql,
          query_params: queryParams,
          hostId,
          format: 'JSONEachRow',
          clickhouse_settings: {
            ...cache,
            ...tableSettings,
          },
          queryConfig: queryConfig.optional
            ? {
                name: queryConfig.name,
                sql: executedSql,
                tableCheck: queryConfig.tableCheck,
                optional: true,
              }
            : undefined,
        })
    )
  )

  if (result.error) {
    error(`[executeTableConfig:${queryConfig.name}]`, result.error)
  }

  return { result, executedSql, clickhouseVersion: version, maxResultRows }
}

export interface ExecuteChartResult {
  dataJson: string | null
  metadata: Record<string, string | number>
  error?: FetchDataResult<never>['error']
  executedSql: string
  clickhouseVersion?: string
}

export async function executeChartQuery(
  chartName: string,
  sql: string | VersionedSql[],
  hostId: number | string,
  queryParams: Record<string, unknown> | undefined,
  opts: ExecuteOptions & {
    optional?: boolean
    tableCheck?: string | string[]
    columnCheck?: string | string[]
    ttlSeconds?: number
    disableQueryCache?: boolean
    clickhouseSettings?: ChartQuerySettings
  } = {}
): Promise<ExecuteChartResult> {
  if (opts.bindings) bridgeClickHouseEnv(opts.bindings)

  const numericHostId = toNumericHostId(hostId)
  const {
    sql: executedSql,
    version,
    clickhouseVersion,
  } = await selectSqlForHost(sql, numericHostId)

  const result = await withClickHouseQuerySpan(() =>
    runWithQueryCache(
      {
        version: clickhouseVersion,
        ttlSeconds: opts.ttlSeconds ?? 0,
        disabled: opts.disableQueryCache,
        hostId,
      },
      (cache) =>
        fetchJsonEachRowAsNormalizedJson({
          query: executedSql,
          query_params: queryParams,
          hostId,
          clickhouse_settings: {
            ...opts.clickhouseSettings,
            ...cache,
            ...(opts.timezone ? { session_timezone: opts.timezone } : {}),
          },
          queryConfig: opts.optional
            ? {
                name: chartName,
                sql: executedSql,
                tableCheck: opts.tableCheck,
                columnCheck: opts.columnCheck,
                optional: true,
              }
            : undefined,
        })
    )
  )

  if (result.error) {
    error(`[executeChartQuery:${chartName}]`, result.error)
  }

  return {
    dataJson: result.dataJson,
    metadata: result.metadata,
    error: result.error,
    executedSql,
    clickhouseVersion: version,
  }
}

export async function executeMultiChartQuery(
  queries: Array<{ key: string; query: string; optional?: boolean }>,
  hostId: number | string,
  opts: ExecuteOptions & {
    ttlSeconds?: number
    disableQueryCache?: boolean
  } = {}
): Promise<{
  results: Array<{
    key: string
    dataJson: string | null
    error?: FetchDataResult<never>['error']
  }>
}> {
  if (opts.bindings) bridgeClickHouseEnv(opts.bindings)

  // Read-only GET path (routes/api/v1/charts/$name.ts summary charts): safe
  // to opt into the ClickHouse query cache (#2182). Resolved once per call —
  // getClickHouseVersion caches per host for 24h, so this is cheap.
  const cacheOpts = {
    version: await getClickHouseVersion(toNumericHostId(hostId)),
    ttlSeconds: opts.ttlSeconds ?? 0,
    disabled: opts.disableQueryCache,
    hostId,
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const r = await withClickHouseQuerySpan(() =>
          runWithQueryCache(cacheOpts, (cache) =>
            fetchJsonEachRowAsNormalizedJson({
              query: q.query,
              hostId,
              clickhouse_settings: {
                ...cache,
                ...(opts.timezone ? { session_timezone: opts.timezone } : {}),
              },
            })
          )
        )
        return { key: q.key, dataJson: r.dataJson ?? 'null', error: r.error }
      } catch (err) {
        return {
          key: q.key,
          dataJson: null,
          error: {
            type: 'query_error' as const,
            message: err instanceof Error ? err.message : 'Unknown error',
          },
        }
      }
    })
  )

  return { results }
}

export async function getWebClient(
  hostId: number,
  bindings?: ClickHouseBindings
) {
  if (bindings) bridgeClickHouseEnv(bindings)
  return getClient({ web: true, hostId })
}

export { getSqlForDisplay }
