import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * MergeTree tables with data that no finished SELECT in this replica's
 * system.query_log read inside the window. This is "unread in the log
 * window", never "unused": the log has a TTL, other replicas and shards keep
 * their own logs, and reads that bypass query_log are not seen.
 * `log_window_start` shows how far back the log really reaches.
 */
export const unusedTablesConfig: QueryConfig = {
  name: 'unused-tables',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['engine'] },
  description:
    'MergeTree tables with no SELECT in the query log window, largest first (top 200). This replica only: other replicas and shards keep their own query_log. Unread in the log window is not the same as unused: tables read only through views or materialized views, or only by jobs that run less often than the window, can appear here. Check log_window_start for how far back the log reaches.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      WITH
        -- query_log.tables stores backQuoteIfNeed(database).backQuoteIfNeed(table); strip the backticks to compare with database.name
        read_tables AS
        (
            SELECT DISTINCT replaceAll(tables, '\`', '') AS read_name
            FROM merge('system', '^query_log')
            ARRAY JOIN tables
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
          database,
          name AS table,
          engine,
          total_bytes AS bytes,
          formatReadableSize(total_bytes) AS readable_bytes,
          round(total_bytes * 100.0 / nullIf(max(total_bytes) OVER (), 0), 2) AS pct_bytes,
          total_rows,
          formatReadableQuantity(total_rows) AS readable_total_rows,
          round(total_rows * 100.0 / nullIf(max(total_rows) OVER (), 0), 2) AS pct_total_rows,
          log_window_start
      FROM system.tables
      WHERE (engine LIKE '%MergeTree')
        AND (database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema'))
        AND (total_bytes > 0)
        AND (concat(database, '.', name) NOT IN read_tables)
      ORDER BY total_bytes DESC
      LIMIT 200`,
  columns: [
    'database',
    'table',
    'engine',
    'readable_bytes',
    'readable_total_rows',
    'log_window_start',
  ],
  columnFormats: {
    table: [
      ColumnFormat.Link,
      { href: '/table?host=[ctx.hostId]&database=[database]&table=[table]' },
    ],
    engine: ColumnFormat.ColoredBadge,
    readable_bytes: ColumnFormat.BackgroundBar,
    readable_total_rows: ColumnFormat.BackgroundBar,
  },
  defaultParams: { days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
