/**
 * Server-side query executor for dashboard.
 *
 * Distills what apps/dashboard's route handlers (charts/[name]/route.ts and
 * tables/[name]/route.ts) do into two reusable functions that TanStack Start
 * `server.handlers` call. It:
 *  - bridges the Worker env onto process.env (see server-env.ts),
 *  - resolves the CH version per host,
 *  - selects the right SQL via @chm/sql-builder's VersionedSql `since` rule,
 *  - runs the query with the WEB client (getClient is invoked internally by
 *    fetchData/fetchJsonEachRowAsNormalizedJson; this app only ships
 *    @clickhouse/client-web and runs on Workers, so the auto-detected client
 *    is the web client — getClient({ web: true }) is the explicit form used
 *    where a raw client is needed),
 *  - passes `optional`/`tableCheck` through for graceful missing-table handling.
 *
 * Auth / feature-permission gating and the schema-driven filter injection from
 * the dashboard are DEFERRED (those modules are not ported yet).
 */

import type { FetchDataResult } from '@chm/clickhouse-client'
import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import type { VersionedSql } from '@chm/sql-builder'
import type { ClickHouseBindings } from '@/lib/api/server-env'
import type { QueryConfig } from '@/lib/query-config'

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
import {
  getTableClickHouseSettings,
  resolveTableResultRowLimit,
} from '@/lib/api/table-query-settings'
import { withClickHouseQuerySpan } from '@/lib/otel/query-span'
import { getSqlForDisplay } from '@/lib/query-config'

/**
 * Default ClickHouse query-cache TTL (seconds) for a table config that does
 * not set `refreshInterval` (#2182). Mirrors the "standard" chart TTL.
 */
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

/** Coerce a hostId (string|number) to a finite number or throw. */
function toNumericHostId(hostId: number | string): number {
  const n = typeof hostId === 'string' ? Number.parseInt(hostId, 10) : hostId
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

/** Options shared by table/chart execution. */
export interface ExecuteOptions {
  /** Worker env binding — bridged onto process.env before querying. */
  bindings?: ClickHouseBindings
  /** IANA timezone for the ClickHouse session. */
  timezone?: string
}

/** Result of executing a table QueryConfig. */
export interface ExecuteTableResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  result: FetchDataResult<T[]>
  /** SQL actually executed (version-selected). */
  executedSql: string
  /** Resolved CH version, if a versioned SQL forced a lookup. */
  clickhouseVersion?: string
  /** Row cap applied to the query (`0` when disabled), see #2490. */
  maxResultRows: number
}

/**
 * Execute a table QueryConfig and return rows as objects. Resolves the right
 * SQL for the host's CH version, then runs via `fetchData` (JSONEachRow).
 */
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
    maxResultRows
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
          // Pass the config so fetchData can existence-check optional tables.
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

/** Result of executing a chart query — raw JSON string (no per-row parse). */
export interface ExecuteChartResult {
  /** ClickHouse rows serialized as a JSON array string (or 'null'). */
  dataJson: string | null
  metadata: Record<string, string | number>
  error?: FetchDataResult<never>['error']
  executedSql: string
  clickhouseVersion?: string
}

/**
 * Execute a single-query chart. Uses `fetchJsonEachRowAsNormalizedJson` so the
 * handler can stream the JSON string straight into the response body without a
 * parse/reserialize round-trip (matches the dashboard chart route).
 */
export async function executeChartQuery(
  chartName: string,
  sql: string | VersionedSql[],
  hostId: number | string,
  queryParams: Record<string, unknown> | undefined,
  opts: ExecuteOptions & {
    optional?: boolean
    tableCheck?: string | string[]
    /** ClickHouse query-cache TTL (seconds); omit/0 to skip caching. */
    ttlSeconds?: number
    /** Per-chart opt-out of the query cache; see ChartQueryResult. */
    disableQueryCache?: boolean
  } = {}
): Promise<ExecuteChartResult> {
  if (opts.bindings) bridgeClickHouseEnv(opts.bindings)

  const numericHostId = toNumericHostId(hostId)
  const {
    sql: executedSql,
    version,
    clickhouseVersion,
  } = await selectSqlForHost(sql, numericHostId)

  // Read-only GET path (routes/api/v1/charts/$name.ts, health/checks.ts):
  // safe to opt into the ClickHouse query cache (#2182).
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
            ...cache,
            ...(opts.timezone ? { session_timezone: opts.timezone } : {}),
          },
          queryConfig: opts.optional
            ? {
                name: chartName,
                sql: executedSql,
                tableCheck: opts.tableCheck,
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

/**
 * Execute a multi-query chart: run every keyed query in parallel and return a
 * `{ key: dataJson }` map plus the first error. Mirrors the dashboard's
 * handleMultiQueryChart, minus the response shaping (left to the handler).
 */
export async function executeMultiChartQuery(
  queries: Array<{ key: string; query: string; optional?: boolean }>,
  hostId: number | string,
  opts: ExecuteOptions & {
    /** ClickHouse query-cache TTL (seconds); omit/0 to skip caching. */
    ttlSeconds?: number
    /** Opt-out of the query cache; see MultiChartQueryResult. */
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

/**
 * Get a raw web ClickHouse client for the given host. Thin wrapper over
 * `getClient({ web: true, hostId })` for callers that need direct client
 * access (e.g. one-off introspection) outside the fetchData helpers. Bridges
 * the Worker env first when provided.
 */
export async function getWebClient(
  hostId: number,
  bindings?: ClickHouseBindings
) {
  if (bindings) bridgeClickHouseEnv(bindings)
  return getClient({ web: true, hostId })
}

export { getSqlForDisplay }
