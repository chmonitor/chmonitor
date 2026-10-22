/**
 * Read-only SQL for "unread in the query log window" findings (#4067).
 *
 * Shared by the insight collector (`usage-collector.ts`) and the agent tool
 * (`get_usage_findings`). The text mirrors the `unused-tables`,
 * `unused-columns` and `unused-projections` query configs, with these
 * deliberate differences: `minOrNull` so an empty log reads as "no window" and
 * not as 1970-01-01, a size floor and LIMIT as parameters, and
 * LOCAL_DATABASES_FILTER so a remote-engine database is never listed.
 *
 * Portable across `enable_analyzer` 0 and 1: plain CTEs and scalar
 * subqueries, no lambda aliases in WITH (#4084), no backslashes. Every query
 * is bounded by `event_date` and a LIMIT, and sees THIS replica only.
 */

import { LOCAL_DATABASES_FILTER } from '../clickhouse-local-databases'
import { TTL_PARTITION_INVENTORY_SETTINGS } from '../health/ttl-partition-sql'

/** The look-back the SQL asks for; the log may hold less. */
export const USAGE_WINDOW_DAYS = 30

/** Client settings: the cap travels as a request setting (same as #4082). */
export const USAGE_FINDINGS_SETTINGS = TTL_PARTITION_INVENTORY_SETTINGS

const SYSTEM_DATABASES = `('system', 'INFORMATION_SCHEMA', 'information_schema')`

const LOG_WINDOW_START = `(
    SELECT minOrNull(event_date)
    FROM merge('system', '^query_log')
    WHERE event_date >= today() - ${USAGE_WINDOW_DAYS}
  ) AS log_window_start`

const LOG_WINDOW_DAYS = `dateDiff('day', log_window_start, today()) AS log_window_days`

function positiveInt(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

/** Days the log really covers, and how many finished SELECTs it holds. */
export const usageLogWindowSql = `SELECT
  minOrNull(event_date) AS log_window_start,
  dateDiff('day', minOrNull(event_date), today()) AS log_window_days,
  count() AS selects
FROM merge('system', '^query_log')
WHERE event_date >= today() - ${USAGE_WINDOW_DAYS}
  AND query_kind = 'Select'
  AND type = 'QueryFinish'`

/** MergeTree tables with at least `minBytes` that no finished SELECT read. */
export function unreadTablesSql(opts: {
  minBytes: number
  limit: number
}): string {
  const minBytes = positiveInt(opts.minBytes, 1)
  const limit = positiveInt(opts.limit, 1)
  return `WITH
  read_tables AS (
    SELECT DISTINCT replaceAll(tables, '\`', '') AS read_name
    FROM merge('system', '^query_log')
    ARRAY JOIN tables
    WHERE query_kind = 'Select'
      AND type = 'QueryFinish'
      AND event_date >= today() - ${USAGE_WINDOW_DAYS}
  ),
  ${LOG_WINDOW_START}
SELECT
  database,
  name AS table,
  total_bytes AS bytes,
  log_window_start,
  ${LOG_WINDOW_DAYS}
FROM system.tables
WHERE engine LIKE '%MergeTree'
  AND ${LOCAL_DATABASES_FILTER}
  AND database NOT IN ${SYSTEM_DATABASES}
  AND total_bytes >= ${minBytes}
  AND concat(database, '.', name) NOT IN read_tables
ORDER BY total_bytes DESC
LIMIT ${limit}`
}

/** Projections of at least `minBytes` that no finished SELECT used. */
export function unusedProjectionsSql(opts: {
  minBytes: number
  limit: number
}): string {
  const minBytes = positiveInt(opts.minBytes, 1)
  const limit = positiveInt(opts.limit, 1)
  return `WITH
  used_projections AS (
    SELECT DISTINCT replaceAll(projections, '\`', '') AS used_name
    FROM merge('system', '^query_log')
    ARRAY JOIN projections
    WHERE query_kind = 'Select'
      AND type = 'QueryFinish'
      AND event_date >= today() - ${USAGE_WINDOW_DAYS}
  ),
  ${LOG_WINDOW_START}
SELECT
  inv_database AS database,
  inv_table AS table,
  inv_name AS name,
  inv_bytes AS bytes,
  log_window_start,
  ${LOG_WINDOW_DAYS}
FROM (
  SELECT
    prj.database AS inv_database,
    prj.table AS inv_table,
    prj.name AS inv_name,
    coalesce(sz.part_bytes, 0) AS inv_bytes
  FROM system.projections AS prj
  LEFT JOIN (
    SELECT
      database AS part_database,
      table AS part_table,
      name AS part_name,
      sum(data_compressed_bytes) AS part_bytes
    FROM system.projection_parts
    WHERE active
    GROUP BY database, table, name
  ) AS sz ON prj.database = sz.part_database AND prj.table = sz.part_table AND prj.name = sz.part_name
  WHERE prj.database NOT IN ${SYSTEM_DATABASES}
)
WHERE inv_bytes >= ${minBytes}
  AND concat(inv_database, '.', inv_table, '.', inv_name) NOT IN used_projections
ORDER BY inv_bytes DESC
LIMIT ${limit}`
}

/**
 * Columns of ONE table (`{table:String}` = `database.name`) that no finished
 * SELECT referenced. Queries with `SELECT *` are left out of the read set, so a
 * column read only through a wildcard looks unread. Tool only: per-table.
 */
export function unreadColumnsSql(opts: { limit: number }): string {
  const limit = positiveInt(opts.limit, 1)
  return `WITH
  read_columns AS (
    SELECT DISTINCT replaceAll(columns, '\`', '') AS read_name
    FROM merge('system', '^query_log')
    ARRAY JOIN columns
    WHERE query_kind = 'Select'
      AND type = 'QueryFinish'
      AND arrayExists(t -> replaceAll(t, '\`', '') = {table:String}, tables)
      AND NOT match(query, '(?i)select[[:space:]]+[*]')
      AND event_date >= today() - ${USAGE_WINDOW_DAYS}
  ),
  ${LOG_WINDOW_START}
SELECT
  database,
  table,
  name,
  type,
  data_compressed_bytes AS bytes,
  log_window_start,
  ${LOG_WINDOW_DAYS}
FROM system.columns
WHERE concat(database, '.', table) = {table:String}
  AND concat(database, '.', table, '.', name) NOT IN read_columns
ORDER BY data_compressed_bytes DESC
LIMIT ${limit}`
}
