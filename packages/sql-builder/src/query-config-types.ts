/**
 * Version-aware SQL definitions shared across packages.
 *
 * These types are intentionally minimal and dependency-free so that lower-level
 * packages (e.g. `@chm/clickhouse-client`) can depend on them without pulling in
 * the full web-app `QueryConfig` type.
 */

export interface VersionedSql {
  /**
   * Minimum ClickHouse version for this query.
   * Supports major.minor (e.g., "24.1") or full version (e.g., "24.1.2.3").
   */
  since: string
  /** SQL query to use for this version and above */
  sql: string
  /** Description of what changed in this version */
  description?: string
  /** Columns available in this version (for type safety) */
  columns?: string[]
}

/**
 * Minimal shape of a query config consumed by `@chm/clickhouse-client`.
 *
 * The full `QueryConfig` interface lives in the web app; this captures only the
 * fields the ClickHouse client reads so the client package does not depend on
 * the web app's god-type.
 */
export interface QueryConfigLike {
  name?: string
  sql?: string | VersionedSql[]
  optional?: boolean
  tableCheck?: string | string[]
  /** Qualified column(s) `database.table.column` that may be absent. */
  columnCheck?: string | string[]
}

/**
 * Get all SQL strings from a sql definition.
 * Useful for parsing tables from all version variants.
 *
 * @example
 * ```ts
 * getAllSqlStrings('SELECT 1') // ['SELECT 1']
 * getAllSqlStrings([
 *   { since: '24.1', sql: 'SELECT 1' },
 *   { since: '24.5', sql: 'SELECT 2' },
 * ]) // ['SELECT 1', 'SELECT 2']
 * ```
 */
export function getAllSqlStrings(sql: string | VersionedSql[]): string[] {
  if (typeof sql === 'string') {
    return [sql]
  }
  return sql.map((v) => v.sql)
}
