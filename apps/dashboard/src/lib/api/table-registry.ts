/**
 * Table/query-config registry for dashboard.
 *
 * Ported from apps/dashboard/lib/api/table-registry.ts. Maps a config `name`
 * to its QueryConfig and resolves a runnable query (SQL + params) from URL
 * search params.
 *
 * Foundation simplifications:
 * - The source list is `queries` from `@/lib/query-config` (empty until the
 *   54 configs are ported). `registerTableConfig` lets ported modules add
 *   configs without editing this file.
 * - Schema-driven `filterSchema` WHERE-clause injection (filters/url-state +
 *   filters/where-builder) is wired in `getTableQuery` below, matching the
 *   dashboard. Configs without a filterSchema fall through to the plain
 *   defaultParams + raw search-params path.
 */

import type { QueryConfig } from '@/lib/query-config'

import { parseFiltersFromParams } from '@/lib/filters/url-state'
import { filterSchemaForVersion } from '@/lib/filters/version-gate'
import {
  applyFilterPlaceholder,
  buildWhereClause,
} from '@/lib/filters/where-builder'
import { getSqlForDisplay, queries } from '@/lib/query-config'

/** Params for building a table query. */
export interface TableQueryParams {
  /** Host id to run against. */
  hostId: number | string
  /** URL search params (filters + query params), minus hostId. */
  searchParams?: Record<string, string>
  /**
   * Server ClickHouse version, used to ignore filter params whose field
   * `since` is newer than the server (a stale `?client_agent=` URL).
   * `undefined` skips gating; `null` means the version is unknown, so gated
   * fields are dropped (matches the client-side gate).
   */
  serverVersion?: string | null
}

/** Result of resolving a table query. */
export interface TableQueryResult {
  /** SQL string for display; execution re-selects the versioned SQL. */
  query: string
  /** Params to substitute (`{name:Type}`). */
  queryParams?: Record<string, unknown>
  /** The resolved config (passed to the executor for version selection). */
  queryConfig: QueryConfig
}

/**
 * Lazy registry seeded from `queries`. Ported domain modules can also call
 * `registerTableConfig` at import time to add configs not in the aggregate.
 */
const tableRegistry = new Map<string, QueryConfig>(
  queries.map((config) => [config.name, config])
)

/** Register one config (overwrites by name). */
export function registerTableConfig(config: QueryConfig): void {
  tableRegistry.set(config.name, config)
}

/** Register many configs at once. */
export function registerTableConfigs(configs: QueryConfig[]): void {
  for (const config of configs) tableRegistry.set(config.name, config)
}

/**
 * Resolve a runnable table query from a config name + URL search params.
 * Returns null if the name is unknown.
 */
export function getTableQuery(
  name: string,
  params: TableQueryParams
): TableQueryResult | null {
  const queryConfig = tableRegistry.get(name)
  if (!queryConfig) return null

  // Schema-driven dynamic filtering: parse + validate active filters against
  // the config's filterSchema, then inject a parameterized WHERE clause into
  // the `/* __FILTERS__ */` placeholder. The resolved config (clause baked in)
  // is returned so the executor's version selection runs on the filtered SQL,
  // not the bare template.
  if (queryConfig.filterSchema) {
    const urlParams = new URLSearchParams(params.searchParams ?? {})
    const filterSchema =
      params.serverVersion === undefined
        ? queryConfig.filterSchema
        : filterSchemaForVersion(
            queryConfig.filterSchema,
            params.serverVersion ?? undefined
          )
    const activeFilters = parseFiltersFromParams(filterSchema, urlParams)
    const { clause, params: filterParams } = buildWhereClause(
      filterSchema,
      activeFilters
    )
    const resolvedConfig: QueryConfig = {
      ...queryConfig,
      sql: applyFilterPlaceholder(queryConfig.sql, clause),
    }
    const mergedParams = {
      ...(resolvedConfig.defaultParams ?? {}),
      ...filterParams,
    }

    return {
      query: getSqlForDisplay(resolvedConfig.sql),
      queryParams:
        Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
      queryConfig: resolvedConfig,
    }
  }

  // Start from the config's default params, then layer URL search params.
  const queryParams: Record<string, unknown> = {
    ...(queryConfig.defaultParams ?? {}),
  }
  if (params.searchParams) Object.assign(queryParams, params.searchParams)

  return {
    // Display string; the executor calls selectVersionedSql for execution.
    query: getSqlForDisplay(queryConfig.sql),
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    queryConfig,
  }
}

/** Does a table config exist? */
export function hasTable(name: string): boolean {
  return tableRegistry.has(name)
}

/** All registered config names, sorted. */
export function getAvailableTables(): string[] {
  return Array.from(tableRegistry.keys()).sort()
}

/** Get a raw config by name. */
export function getTableConfig(name: string): QueryConfig | undefined {
  return tableRegistry.get(name)
}
