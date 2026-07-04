/**
 * QueryConfig types for the TanStack Start dashboard (dashboard).
 *
 * Ported from apps/dashboard/types/query-config.ts, trimmed to the
 * *foundation* surface: the fields the server-side query executor and the
 * registries actually consume. The dashboard's full QueryConfig couples to
 * web-app-only types (ChartProps, CustomSortingFnNames, FeaturePermission,
 * ColumnFormat) that belong to the not-yet-ported component / data-table
 * layer. Those UI-formatting fields are DEFERRED and intentionally omitted
 * here. `filterSchema` IS included — it drives server-side WHERE injection
 * (see the table registry), and `@/lib/filters/types` is ported.
 *
 * VersionedSql / getAllSqlStrings come from @chm/sql-builder (aliased to
 * source in tsconfig.json) so this app never depends on the dashboard package.
 */

import type { ClickHouseSettings } from '@clickhouse/client'

import type { VersionedSql } from '@chm/sql-builder'
import type { FilterSchema } from '@/lib/filters/types'

// Re-export the version-compat SQL primitives from the shared package so
// `@/lib/query-config/types` consumers can import them from one place,
// mirroring the dashboard's `@/types/query-config` re-export.
export { getAllSqlStrings, type VersionedSql } from '@chm/sql-builder'

/**
 * Foundation QueryConfig.
 *
 * Generic over the column-name tuple, exactly like the dashboard. Only the
 * fields the executor / registry need are kept:
 * - identity + SQL (name, sql, columns)
 * - version compat (sql: VersionedSql[] | string)
 * - execution knobs (defaultParams, clickhouseSettings, optional, tableCheck)
 * - validation toggle (disableSqlValidation)
 *
 * To extend with UI-formatting later (columnFormats, filterSchema, card, …),
 * add them here as the corresponding component layer is ported. Keeping them
 * out now avoids importing un-ported app types.
 */
export interface QueryConfig<TColumns extends readonly string[] = string[]> {
  /** Unique registry key. */
  name: string
  /** Optional human description. */
  description?: string
  /**
   * SQL — a plain string (version-independent) or VersionedSql[] (ordered
   * oldest→newest; the executor picks the highest `since` <= CH version).
   */
  sql: string | VersionedSql[]
  /** Result column names (drives row typing + display ordering). */
  columns: TColumns
  /**
   * Default ClickHouse query parameters, e.g. `{ database: 'default' }` for
   * `WHERE database = {database:String}`. Merged under URL search params.
   */
  defaultParams?: Record<string, string | number | boolean>
  /** Per-query ClickHouse settings (e.g. result limits, timezone). */
  clickhouseSettings?: ClickHouseSettings
  /**
   * Opt out of the ClickHouse query-cache settings (#2182) that
   * `executeTableConfig` applies by default to this (read-only) query. Set
   * this when the result must never be served from the query cache.
   */
  disableQueryCache?: boolean
  /**
   * Auto-refresh interval (ms) for client polling. Foundation carries it so
   * the later client layer can read it; the server executor ignores it.
   */
  refreshInterval?: number
  /**
   * Mark the query as optional — its table(s) may not exist (e.g.
   * system.error_log, system.backup_log, system.zookeeper). The executor
   * passes this through to fetchData so a missing table degrades gracefully
   * instead of erroring.
   */
  optional?: boolean
  /**
   * Explicit table(s) to existence-check when `optional`. If omitted, tables
   * are auto-extracted from the SQL by the underlying validator.
   */
  tableCheck?: string | string[]
  /**
   * Schema-driven dynamic filtering. When present, the table registry parses
   * active filters from URL params against this schema and injects a
   * parameterized WHERE clause into the SQL's `/* __FILTERS__ *​/` placeholder.
   * The schema is the trusted SQL source (column UI is sugar over it).
   */
  filterSchema?: FilterSchema
  /** Disable SQL validation (used by the query-config test suite). */
  disableSqlValidation?: boolean
  /** Optional docs URL surfaced on query error. */
  docs?: string
}

/** Map a column-name tuple to a permissive row-data shape. */
export type QueryConfigRowData<T extends readonly string[]> = {
  [K in T[number]]: unknown
}

/** Extract the row-data shape from a QueryConfig. */
export type QueryConfigToRowData<T extends QueryConfig> = QueryConfigRowData<
  T['columns']
>

/**
 * Get a single SQL string for *display* (not execution). Returns the string
 * directly, or the newest (last) entry of a VersionedSql[]. Execution-time
 * version selection happens in the executor via `selectVersionedSql`.
 */
export function getSqlForDisplay(sql: string | VersionedSql[]): string {
  if (typeof sql === 'string') return sql
  if (sql.length === 0) return ''
  return sql[sql.length - 1].sql
}
