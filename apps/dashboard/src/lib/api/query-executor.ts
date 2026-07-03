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
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { withClickHouseQuerySpan } from '@/lib/otel/query-span'
import { getSqlForDisplay } from '@/lib/query-config'

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
 */
async function selectSqlForHost(
  sql: string | VersionedSql[],
  numericHostId: number
): Promise<{ sql: string; version: string | undefined }> {
  if (typeof sql === 'string') return { sql, version: undefined }
  const version = await getClickHouseVersion(numericHostId)
  return { sql: selectVersionedSql(sql, version), version: version?.raw }
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
  const { sql: executedSql, version } = await selectSqlForHost(
    queryConfig.sql,
    numericHostId
  )

  const result = await withClickHouseQuerySpan(() =>
    fetchData<T[]>({
      query: executedSql,
      query_params: queryParams,
      hostId,
      format: 'JSONEachRow',
      clickhouse_settings: {
        ...queryConfig.clickhouseSettings,
        ...(options.timezone ? { session_timezone: options.timezone } : {}),
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

  if (result.error) {
    error(`[executeTableConfig:${queryConfig.name}]`, result.error)
  }

  return { result, executedSql, clickhouseVersion: version }
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
  } = {}
): Promise<ExecuteChartResult> {
  if (opts.bindings) bridgeClickHouseEnv(opts.bindings)

  const numericHostId = toNumericHostId(hostId)
  const { sql: executedSql, version } = await selectSqlForHost(
    sql,
    numericHostId
  )

  const result = await withClickHouseQuerySpan(() =>
    fetchJsonEachRowAsNormalizedJson({
      query: executedSql,
      query_params: queryParams,
      hostId,
      clickhouse_settings: opts.timezone
        ? { session_timezone: opts.timezone }
        : undefined,
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
  opts: ExecuteOptions = {}
): Promise<{
  results: Array<{
    key: string
    dataJson: string | null
    error?: FetchDataResult<never>['error']
  }>
}> {
  if (opts.bindings) bridgeClickHouseEnv(opts.bindings)

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const r = await withClickHouseQuerySpan(() =>
          fetchJsonEachRowAsNormalizedJson({
            query: q.query,
            hostId,
            clickhouse_settings: opts.timezone
              ? { session_timezone: opts.timezone }
              : undefined,
          })
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
