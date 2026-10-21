import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Columns of ONE table that no finished SELECT in this replica's
 * system.query_log referenced inside the window. This is "unread in the log
 * window", never "unused": the log has a TTL, other replicas keep their own
 * logs, and reads through views, materialized views or INSERT ... SELECT are
 * not attributed here. A `SELECT *` query lists every column, so queries that
 * match the wildcard pattern are left out of the read set (the regex runs on
 * the server; the query text is never returned). A column read only through
 * `SELECT *` therefore looks unread.
 *
 * `table` is database-qualified (`db.name`), like top-usage-columns.
 * query_log stores `db.table.column` with backQuoteIfNeed on each part, so
 * backticks are stripped before comparing. No lambda alias in WITH: the old
 * analyzer cannot see it from WHERE (#4084).
 */
export const unusedColumnsConfig: QueryConfig = {
  name: 'unused-columns',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['type'] },
  description:
    'Columns of one table (set table to database.name) that no finished SELECT in the query log window referenced, largest compressed size first (top 200). This replica only: other replicas and shards keep their own query_log. Unread in the log window is not the same as unused: columns read only through views, materialized views or INSERT ... SELECT, or only by jobs that run less often than the window, can appear here. Queries containing SELECT * are excluded from the read set, so a column read only through SELECT * can look unread. Check log_window_start for how far back the log reaches.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      WITH
        -- query_log.columns stores db.table.column with backQuoteIfNeed on each part; strip the backticks to compare with system.columns
        read_columns AS
        (
            SELECT DISTINCT replaceAll(columns, '\`', '') AS read_name
            FROM merge('system', '^query_log')
            ARRAY JOIN columns
            WHERE (query_kind = 'Select')
              AND (type = 'QueryFinish')
              AND (arrayExists(t -> replaceAll(t, '\`', '') = {table:String}, tables))
              AND (NOT match(query, '(?i)select\\\\s+\\\\*'))
              AND (event_date >= today() - {days:UInt16})
        ),
        (
            SELECT min(event_date)
            FROM merge('system', '^query_log')
            WHERE (event_date >= today() - {days:UInt16})
        ) AS log_window_start
      SELECT
          database,
          table,
          name,
          type,
          data_compressed_bytes AS bytes,
          formatReadableSize(data_compressed_bytes) AS readable_bytes,
          round(data_compressed_bytes * 100.0 / nullIf(max(data_compressed_bytes) OVER (), 0), 2) AS pct_bytes,
          log_window_start
      FROM system.columns
      WHERE (concat(database, '.', table) = {table:String})
        AND (concat(database, '.', table, '.', name) NOT IN read_columns)
      ORDER BY data_compressed_bytes DESC
      LIMIT 200`,
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
  defaultParams: { table: '', days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
