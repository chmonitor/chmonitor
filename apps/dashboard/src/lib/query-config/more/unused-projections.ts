import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Projections that no finished SELECT in this replica's system.query_log
 * used inside the window. "Unused in the log window", never "safe to drop":
 * the log has a TTL, other replicas keep their own logs, and a projection
 * that served no query here may still serve queries on another replica.
 *
 * Inventory is system.projections; size is the sum of active
 * system.projection_parts, joined in a nested subquery so every output alias
 * differs from its source column. query_log.projections stores
 * `db.table.projection` (verified on 26.5). Its since-version is not in
 * docs/clickhouse-schemas, so the SQL is gated at 23.8, the oldest version
 * the other query_log configs support.
 *
 * Data-skipping indices are NOT covered: query_log has no column that records
 * which skipping indices a query used.
 */
export const unusedProjectionsConfig: QueryConfig = {
  name: 'unused-projections',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['type'] },
  description:
    'Projections that no finished SELECT in the query log window used, largest compressed size first (top 200). This replica only: other replicas and shards keep their own query_log. Unused in the log window is not the same as unneeded: a projection kept for a job that runs less often than the window, or one that only serves queries on another replica, can appear here. Data-skipping indices are not listed because the query log does not record which indices a query used. Check log_window_start for how far back the log reaches.',
  docs: QUERY_LOG,
  optional: true,
  tableCheck: ['system.query_log', 'system.projections'],
  sql: [
    {
      since: '23.8',
      sql: `
      WITH
        -- query_log.projections stores db.table.projection with backQuoteIfNeed on each part; strip the backticks to compare with system.projections
        used_projections AS
        (
            SELECT DISTINCT replaceAll(projections, '\`', '') AS used_name
            FROM merge('system', '^query_log')
            ARRAY JOIN projections
            WHERE (query_kind = 'Select')
              AND (type = 'QueryFinish')
              AND (event_date >= today() - {days:UInt16})
        ),
        (
            SELECT minOrNull(event_date)
            FROM merge('system', '^query_log')
            WHERE (event_date >= today() - {days:UInt16})
        ) AS log_window_start
      SELECT
          inv_database AS database,
          inv_table AS table,
          inv_name AS name,
          inv_type AS type,
          inv_bytes AS bytes,
          formatReadableSize(inv_bytes) AS readable_bytes,
          round(inv_bytes * 100.0 / nullIf(max(inv_bytes) OVER (), 0), 2) AS pct_bytes,
          log_window_start
      FROM
      (
          SELECT
              prj.database AS inv_database,
              prj.table AS inv_table,
              prj.name AS inv_name,
              toString(prj.type) AS inv_type,
              coalesce(sz.part_bytes, 0) AS inv_bytes
          FROM system.projections AS prj
          LEFT JOIN
          (
              SELECT
                  database AS part_database,
                  table AS part_table,
                  name AS part_name,
                  sum(data_compressed_bytes) AS part_bytes
              FROM system.projection_parts
              WHERE active
              GROUP BY database, table, name
          ) AS sz ON (prj.database = sz.part_database) AND (prj.table = sz.part_table) AND (prj.name = sz.part_name)
          WHERE (prj.database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema'))
      )
      WHERE (concat(inv_database, '.', inv_table, '.', inv_name) NOT IN used_projections)
      ORDER BY inv_bytes DESC
      LIMIT 200`,
      description:
        'Inventory from system.projections, usage from query_log.projections',
    },
  ] as VersionedSql[],
  columns: [
    'database',
    'table',
    'name',
    'type',
    'readable_bytes',
    'log_window_start',
  ],
  columnFormats: {
    type: ColumnFormat.ColoredBadge,
    readable_bytes: ColumnFormat.BackgroundBar,
  },
  defaultParams: { days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
