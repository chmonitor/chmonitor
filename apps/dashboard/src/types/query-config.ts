import type { Row } from '@tanstack/react-table'
import type { ClickHouseSettings } from '@clickhouse/client'

import type { VersionedSql } from '@chm/sql-builder'
import type { Icon } from '@chm/types/icon'
import type { ChartProps } from '@/components/charts/chart-props'
import type { CustomSortingFnNames } from '@/components/data-table/sorting-fns'
import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { FilterOperator, FilterSchema } from '@/lib/filters/types'
import type { ColumnFormat, ColumnFormatWithArgs } from '@/types/column-format'

/** Callback to compute conditional CSS class for a table row */
export type RowClassNameFn = (
  row: Record<string, unknown>
) => string | undefined

export interface ColumnSizingConfig {
  /** Preferred column width in pixels */
  size?: number
  /** Minimum column width in pixels */
  minSize?: number
  /** Maximum column width in pixels */
  maxSize?: number
}

/**
 * Per-column filter declaration that appears in the column header.
 * UI sugar over `filterSchema` — the schema remains the trusted SQL source.
 * A column-header filter only renders when a matching field exists in the
 * schema (by `fieldKey` or column name).
 */
export interface ColumnFilterDef {
  /** Input type shown in the column-header filter popover. */
  type: 'text' | 'numeric' | 'date' | 'date-range' | 'multi-select' | 'boolean'
  /** Static options for multi-select; dynamicOptions in filterSchema take precedence. */
  options?: string[]
  /** Placeholder for text/numeric input. */
  placeholder?: string
  /** Override which filterSchema field key this column maps to (default: column name). */
  fieldKey?: string
  /** Override default operator (otherwise derived from `type`). */
  operator?: FilterOperator
}

/**
 * Inline row-expansion renderer. The returned node is rendered in a
 * full-width `<tr><td colSpan={columns}>` below the row.
 */
export type ExpandedRenderer<TData = Record<string, unknown>> = (
  row: TData,
  context: { row: Row<TData> }
) => React.ReactNode

export interface ExpandableConfig<TData = Record<string, unknown>> {
  /** Renderer for the expanded panel below a row. */
  renderExpanded: ExpandedRenderer<TData>
  /** Initial expanded state for newly fetched rows. */
  defaultExpanded?: boolean
}

/**
 * Declarative card-view layout. Tells the responsive card renderer how to
 * rank a row's columns by importance instead of guessing: which column is the
 * hero (rendered as the prominent block that reads first), which are surfaced
 * as header badges, which collapse into the compact metric chip row, and which
 * to omit. When a config sets none of these, the renderer falls back to its
 * historical heuristic, so this is purely opt-in.
 *
 * This is how a page declares "the query matters more than its metadata".
 *
 * @example Running / history queries — the SQL is the hero
 * ```ts
 * card: {
 *   primary: 'query',
 *   badges: ['query_kind', 'type'],
 *   metrics: ['user', 'query_duration', 'event_time'],
 *   hidden: ['readable_result_rows'],
 * }
 * ```
 */
export interface CardConfig<TColumns extends readonly string[] = string[]> {
  /**
   * Hero column rendered prominently at the top of each card. Overrides the
   * heuristic primary-column detection.
   */
  primary?: TColumns[number]
  /**
   * Columns surfaced as badges in the card header — typically status / kind /
   * type columns formatted with {@link ColumnFormat.ColoredBadge}.
   */
  badges?: TColumns[number][]
  /**
   * Columns shown as a compact icon+value metric chip row beneath the hero, in
   * the order declared. Leading icons come from `columnIcons`. These should be
   * the live metrics that must read at a glance (duration, memory, time, …).
   */
  metrics?: TColumns[number][]
  /**
   * Columns to omit from the card entirely — noise, or values already implied
   * by the hero / metrics.
   */
  hidden?: TColumns[number][]
}

/**
 * Per-table behavior configuration. Each flag is optional and falls back to a
 * sensible default. Use this on a QueryConfig to override defaults for a
 * specific table (e.g. disable resizing for compact summary tables).
 */
export interface TableBehaviorConfig {
  /** Enable column resizing via drag handles (default: true) */
  enableColumnResizing?: boolean
  /**
   * When to commit column size changes:
   * - 'onChange': live, updates every pointermove (default — feels responsive)
   * - 'onEnd': commits only after the user releases the mouse
   */
  columnResizeMode?: 'onChange' | 'onEnd'
  /** Enable click-to-sort on column headers (default: true) */
  enableSorting?: boolean
  /** Enable drag-and-drop column reordering (default: true) */
  enableColumnReordering?: boolean
}

/**
 * Infer row data type from column names array
 *
 * @example
 * ```ts
 * type RowData = QueryConfigRowData<['database', 'table', 'engine']>
 * // Result: { database: unknown; table: unknown; engine: unknown }
 * ```
 */
export type QueryConfigRowData<T extends readonly string[]> = {
  [K in T[number]]: unknown
}

/**
 * Convert readonly array to mutable tuple for stricter column typing
 *
 * @example
 * ```ts
 * type Columns = ColumnNames<'database' | 'table' | 'engine'>
 * // Result: ['database', 'table', 'engine']
 * ```
 */
export type ColumnNames<T extends string> = [T, ...T[]]

/**
 * A version-specific SQL query for ClickHouse version compatibility.
 *
 * Queries are defined chronologically (oldest → newest) and the system
 * picks the highest `since` version that is <= current ClickHouse version.
 *
 * @example Version-aware queries
 * ```ts
 * sql: [
 *   { since: '23.8', sql: 'SELECT col1 FROM system.table' },
 *   { since: '24.1', sql: 'SELECT col1, col2 FROM system.table' },
 *   { since: '25.6', sql: 'SELECT col1, col2, col3 FROM system.table' },
 * ]
 * // For CH v24.5 → selects '24.1' query (highest <= 24.5)
 * // For CH v25.8 → selects '25.6' query (highest <= 25.8)
 * // For CH v23.5 → selects '23.8' query (fallback to oldest)
 * ```
 *
 * ## Cross-Version Enum/Int8 Compatibility
 *
 * Some ClickHouse columns changed from Int8 to Enum between versions (e.g.,
 * `event_type` and `merge_reason` in `system.part_log`). When using `merge()`
 * to query across shards with different schemas, use `toInt8()` for compatibility:
 *
 * @example Enum/Int8 compatible comparison
 * ```ts
 * // Works with both Int8 (older) and Enum (newer) column types
 * sql: `
 *   SELECT * FROM merge('system', '^part_log')
 *   WHERE toInt8(event_type) = 2      -- MergeParts
 *     AND toInt8(merge_reason) = 1    -- RegularMerge
 * `
 *
 * // Known event_type values (from ClickHouse source):
 * // 1 = NewPart, 2 = MergeParts, 3 = DownloadPart, 4 = RemovePart,
 * // 5 = MutatePart, 6 = MovePart, 7 = MutatePartStart, 8 = MergePartsStart
 *
 * // Known merge_reason values:
 * // 1 = RegularMerge, 2 = TTLDeleteMerge, 3 = TTLRecompressMerge
 * ```
 *
 * ## Cluster Queries: merge() vs Direct Table Access
 *
 * The `merge('system', '^part_log')` function aggregates data across all
 * shards/replicas in a cluster, matching tables like:
 * - `system.part_log` (local)
 * - `system.part_log_1`, `system.part_log_2`, etc. (replicated tables)
 *
 * **Tradeoffs:**
 * - `merge()`: See all cluster data, but may have schema compatibility issues
 *   between shards with different ClickHouse versions
 * - `system.part_log`: Simpler, only local node data, no schema conflicts
 *
 * When using `merge()` across shards with different schemas, use `toInt8()`
 * for Enum columns to ensure compatibility.
 */
// VersionedSql and getAllSqlStrings live in @chm/sql-builder so lower-level
// packages can consume them without depending on this web-app god-type.
// Re-exported here for backward compatibility with existing consumers.
export { getAllSqlStrings, type VersionedSql } from '@chm/sql-builder'

export interface QueryConfig<TColumns extends readonly string[] = string[]> {
  name: string
  /** Feature gate metadata for deployment-level permissions */
  permission?: FeaturePermission
  description?: string
  /**
   * Auto-refresh interval for table data in milliseconds.
   * Leave unset to fetch once and rely on manual refresh.
   */
  refreshInterval?: number
  /**
   * Helpful suggestion displayed in empty state when no data is available.
   * Shows below "No data" message with setup examples and documentation links.
   *
   * @example
   * ```ts
   * suggestion: `Enable query cache with:
   * SET enable_query_result_cache = 1;
   * SET query_cache_max_size_in_bytes = 1073741824;
   *
   * Learn more: https://clickhouse.com/docs/en/operations/query-cache`
   * ```
   */
  suggestion?: string
  /**
   * SQL query definition - either:
   * - A string (version-independent query)
   * - An array of VersionedSql (version-aware queries, ordered oldest→newest)
   *
   * @example Version-independent (simple string)
   * ```ts
   * sql: 'SELECT * FROM system.tables'
   * ```
   *
   * @example Version-aware (array of VersionedSql)
   * ```ts
   * sql: [
   *   { since: '23.8', sql: 'SELECT col1 FROM system.table' },
   *   { since: '24.1', sql: 'SELECT col1, col2 FROM system.table' },
   * ]
   * ```
   */
  sql: string | VersionedSql[]
  /**
   * Whether to disable the SQL validation by [query-config.test.ts](query-config.test.ts).
   *
   * Default: false
   */
  disableSqlValidation?: boolean
  columns: TColumns
  /**
   * Column format can be specified as a enum ColumnFormat
   * or an array of two elements [ColumnFormat.Action, arg]
   *
   * Example:
   *
   * ```ts
   * columnFormats: {
   *   query: ColumnFormat.Code,
   *   changed: ColumnFormat.Boolean,
   *   query_id: [ColumnFormat.Action, ['kill-query']],
   *   table: [ColumnFormat.Link, { href: '/tables/[table]' }],
   * }
   * ```
   *
   * When using typed columns, columnFormats are restricted to valid column names:
   * ```ts
   * const config: QueryConfig<['database', 'table']> = {
   *   columns: ['database', 'table'],
   *   columnFormats: {
   *     database: ColumnFormat.Text,  // OK
   *     table: ColumnFormat.Text,     // OK
   *     invalid: ColumnFormat.Text,   // Type error!
   *   }
   * }
   * ```
   */
  columnFormats?: Partial<
    Record<TColumns[number], ColumnFormat | ColumnFormatWithArgs>
  >
  /**
   * Column icons can be specified as React Component name.
   *
   * Example:
   * ```ts
   * import { CalendarIcon } from 'lucide-react'
   * import { GlobeIcon } from '@radix-ui/react-icons'
   * columnIcons: {
   *  date: CalendarIcon,
   *  language: GlobeIcon
   * }
   * ```
   */
  columnIcons?: {
    [key: string]: Icon
  }
  /** Optional human-readable descriptions/tooltips for table columns */
  columnDescriptions?: Record<string, string>
  /**
   * Optional TanStack column sizing hints keyed by normalized or raw column name.
   * Use this only for columns whose default width creates poor scan density.
   */
  columnSizing?: Record<string, ColumnSizingConfig>
  /**
   * Per-table behavior overrides (resize / sort / reorder / cached fetching).
   * Each field is optional; omitted fields fall back to the global default.
   *
   * @example
   * ```ts
   * tableBehavior: {
   *   enableColumnResizing: false, // lock column widths
   *   columnResizeMode: 'onEnd',   // batched commit for very large tables
   * }
   * ```
   */
  tableBehavior?: TableBehaviorConfig
  relatedCharts?:
    | string[]
    | [string, Omit<ChartProps, 'hostId'>][]
    | (string | [string, Omit<ChartProps, 'hostId'>])[]
  /**
   * Default parameters for the query
   * For example in the query:
   * ```sql
   * SELECT * FROM system.tables WHERE database = {database: String}
   * ```
   * The default parameters would be:
   * ```json
   * { defaultParams: { database: 'default' } }
   * ```
   */
  defaultParams?: Record<string, string | number | boolean>
  /**
   * Filter presets are predefined filters that can be applied to the query
   * For example:
   * ```ts
   * filterPresets: [
   *  {
   *    name: 'Changed only',
   *    key: 'changed',
   *    sql: 'changed = 1',
   *  },
   * ]
   */
  filterParamPresets?: {
    name: string
    key: string
    value: string
    icon?: Icon
  }[]
  /**
   * Declarative, schema-driven filter configuration.
   *
   * When set, the table query must contain the `FILTER_PLACEHOLDER` marker.
   * The server parses active filters from the URL, validates them against this
   * schema, and injects a parameterized `WHERE` clause at the marker. This
   * also drives the dynamic filter bar UI.
   *
   * @see {@link FilterSchema}
   */
  filterSchema?: FilterSchema
  /**
   * ClickHouse settings to be used for this query
   */
  clickhouseSettings?: ClickHouseSettings
  /**
   * Opt out of the ClickHouse query-cache settings (#2182) that
   * `executeTableConfig` applies by default to this (read-only) query. Set
   * this when the result must never be served from the query cache — e.g. it
   * should reflect a change made moments ago sooner than `refreshInterval`
   * allows.
   */
  disableQueryCache?: boolean
  /**
   * The documents or url to be used when query is errors. e.g. log table missing due to cluster configuration.
   */
  docs?: string
  /**
   * Whether the query is optional or not. If the query is optional, it can be raised as a error due to missing table or view.
   * e.g. system.error_log (when there is no error), system.zookeeper (when zookeeper is not configured), system.backup_log (when there is no backup).
   *
   * Default: false
   */
  optional?: boolean
  /**
   * Explicit table(s) to check for existence when the query is marked as optional.
   * If not provided, tables will be automatically extracted from the SQL query.
   *
   * Example:
   * ```ts
   * tableCheck: "system.backup_log"
   * ```
   *
   * For multiple tables:
   * ```ts
   * tableCheck: ["system.backup_log", "system.error_log"]
   * ```
   */
  tableCheck?: string | string[]
  /**
   * Sorting functions to be used for table.
   *
   * Example:
   * ```ts
   * sortingFns: {
   *   readable_avg_part_size_compressed: 'sort_column_using_pct',
   *   readable_avg_part_size_uncompressed: 'sort_column_using_pct',
   * }
   * ```
   */
  sortingFns?: Record<string, CustomSortingFnNames>
  /**
   * Callback to compute a CSS class name for a given row.
   * Useful for conditional row highlighting (e.g., slow queries).
   *
   * @example
   * ```ts
   * rowClassName: (row) => {
   *   const duration = Number(row.query_duration_ms || 0)
   *   if (duration > 30000) return 'bg-red-50 dark:bg-red-950/20'
   *   if (duration > 5000) return 'bg-amber-50 dark:bg-amber-950/20'
   *   return undefined
   * }
   * ```
   */
  rowClassName?: RowClassNameFn
  /**
   * Per-column filter declarations rendered in the column header popover.
   * Renders only for columns whose `fieldKey` (or column name) maps to a
   * `filterSchema.fields[].key`. The schema stays the trusted SQL source;
   * `columnFilters` is UI sugar.
   *
   * @example
   * ```ts
   * columnFilters: {
   *   user: { type: 'multi-select' },
   *   query: { type: 'text', placeholder: 'SELECT ...' },
   *   event_time: { type: 'date-range' },
   * }
   * ```
   */
  columnFilters?: Partial<Record<TColumns[number], ColumnFilterDef>>
  /**
   * Enable inline row expansion. Clicking a row toggles a full-width detail
   * panel below it. Pass `true` for the default JSON renderer, or supply a
   * custom renderer.
   *
   * @example
   * ```ts
   * expandable: {
   *   renderExpanded: (row) => <RunningQueryDetails row={row} />,
   * }
   * ```
   */
  expandable?: true | ExpandableConfig
  /**
   * Default rendering for the result set. `'cards'` renders each row as a card
   * (reusing the responsive card layout) instead of a wide table — better UX
   * for low-cardinality, wide tables like clusters or disks. `'auto'` keeps the
   * responsive default (cards on mobile, table on desktop) while still offering
   * the toggle, so phone users can opt back into the table. When set (including
   * `'auto'`), a table/cards toggle is offered in the toolbar so users can
   * switch, and the chosen view then applies at every breakpoint.
   *
   * @default 'table'
   */
  defaultView?: 'table' | 'cards' | 'auto'
  /**
   * Declarative card-view layout — which column is the hero, which become
   * header badges, which collapse into the metric chip row, and which are
   * hidden. Drives the responsive card renderer so importance is a config
   * decision, not a render-time guess. Falls back to a heuristic when unset.
   *
   * @see {@link CardConfig}
   */
  card?: CardConfig<TColumns>
  /**
   * Bulk actions available for selected rows (shown in toolbar).
   * These actions apply to all selected rows at once.
   *
   * Example:
   * ```ts
   * bulkActions: ['kill-query', 'explain-query']
   * ```
   */
  bulkActions?: string[]
  /**
   * The column key that contains the unique identifier for bulk actions.
   * Defaults to 'query_id' if not specified.
   */
  bulkActionKey?: string
}

/**
 * Helper type to extract row data from a QueryConfig
 *
 * @example
 * ```ts
 * const tablesConfig: QueryConfig<['database', 'table']> = { ... }
 * type TablesRow = QueryConfigToRowData<typeof tablesConfig>
 * // Result: { database: unknown; table: unknown }
 * ```
 */
export type QueryConfigToRowData<T extends QueryConfig> = QueryConfigRowData<
  T['columns']
>

// ============================================================================
// SQL Helper Functions
// ============================================================================

/**
 * Get a single SQL string for display purposes.
 * Returns the first SQL from VersionedSql[] or the string directly.
 *
 * @example
 * ```ts
 * getSqlForDisplay('SELECT 1') // Returns 'SELECT 1'
 * getSqlForDisplay([{ since: '24.1', sql: 'SELECT 1' }]) // Returns 'SELECT 1'
 * ```
 */
export function getSqlForDisplay(sql: string | VersionedSql[]): string {
  if (typeof sql === 'string') {
    return sql
  }
  if (sql.length === 0) {
    return ''
  }
  // Return the last (newest) SQL for display
  return sql[sql.length - 1].sql
}
