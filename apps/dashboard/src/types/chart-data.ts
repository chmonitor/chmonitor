import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { VersionedSql } from './query-config'

/**
 * Cache policy for HTTP Cache-Control headers.
 * - realtime: short TTL (10s/30s) for frequently changing data
 * - standard: moderate TTL (30s/60s) for typical dashboard data
 * - historical: long TTL (120s/300s) for rarely changing historical data
 */
export type CachePolicy = 'realtime' | 'standard' | 'historical'

// Re-export VersionedSql for convenience
export type { VersionedSql }

/**
 * Base chart data point interface
 * Represents a single row of chart data with dynamic properties
 *
 * Note: This type is intentionally permissive to support various data structures
 * including nested objects and arrays that may appear in chart data.
 * For type safety in chart components, use specific generic types with useChartData.
 */
export interface ChartDataPoint {
  [key: string]: unknown
}

/**
 * Time series data point with required event_time field
 * Used for time-based charts
 */
export interface TimeSeriesPoint extends ChartDataPoint {
  event_time: string
}

/**
 * Query parameters for chart data requests
 */
export interface ChartQueryParams {
  interval?: ClickHouseInterval
  lastHours?: number
  params?: Record<string, unknown>
  /** IANA timezone for ClickHouse session (e.g., "America/Los_Angeles", "UTC") */
  timezone?: string
}

/**
 * Version range specification for query variants
 * Specifies which ClickHouse versions a query variant supports
 */
export interface VersionRange {
  /** Minimum version (inclusive), format: "major.minor" or "major.minor.patch" */
  minVersion?: string
  /** Maximum version (exclusive), format: "major.minor" or "major.minor.patch" */
  maxVersion?: string
}

/**
 * Query variant for a specific ClickHouse version range
 * Allows defining different SQL for different ClickHouse versions
 */
export interface QueryVariant {
  /** Version range this variant applies to */
  versions: VersionRange
  /** SQL query for this version range */
  query: string
  /** Description of what's different in this variant */
  description?: string
}

/**
 * Result of a chart query builder function
 * Contains SQL query and metadata for execution
 */
export interface ChartQueryResult<_T extends ChartDataPoint = ChartDataPoint> {
  /** Feature gate metadata for deployment-level permissions */
  permission?: FeaturePermission
  /**
   * SQL query definition - either:
   * - A string (version-independent query, for backward compatibility also use `query`)
   * - An array of VersionedSql (version-aware queries, ordered oldest→newest)
   *
   * When using VersionedSql[], queries are defined chronologically and the system
   * picks the highest `since` version that is <= current ClickHouse version.
   *
   * @example Version-aware (array of VersionedSql)
   * ```ts
   * sql: [
   *   { since: '20.5', sql: 'SELECT event_type FROM system.part_log WHERE event_type = 2' },
   *   { since: '23.8', sql: "SELECT event_type FROM system.part_log WHERE event_type = 'MergeParts'" },
   * ]
   * ```
   */
  sql?: VersionedSql[]
  /**
   * Simple SQL query string (version-independent)
   * If both `sql` (VersionedSql[]) and `query` are provided, `sql` takes precedence
   */
  query: string
  queryParams?: Record<string, unknown>
  optional?: boolean
  tableCheck?: string | string[]
  columnCheck?: string | string[]
  /** Cache policy for HTTP Cache-Control headers */
  cachePolicy?: CachePolicy
  /**
   * @deprecated Use `sql: VersionedSql[]` instead. Will be removed in v0.3.0.
   *
   * Alternative query variants for different ClickHouse versions
   * The first matching variant (by version) will be used
   * If no variant matches, the main `query` is used as fallback
   */
  variants?: QueryVariant[]
}

/**
 * Result for multi-chart queries
 * Contains multiple queries with keys for identification
 */
export interface MultiChartQueryResult {
  queries: Array<{ key: string; query: string; optional?: boolean }>
  /** Feature gate metadata for deployment-level permissions */
  permission?: FeaturePermission
  /** Cache policy for HTTP Cache-Control headers */
  cachePolicy?: CachePolicy
}

/**
 * Query builder function type
 * Takes parameters and returns a query configuration
 */
export type ChartQueryBuilder<T extends ChartDataPoint = ChartDataPoint> = (
  params: ChartQueryParams
) => ChartQueryResult<T> | MultiChartQueryResult
