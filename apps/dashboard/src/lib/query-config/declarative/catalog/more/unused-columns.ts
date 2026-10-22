import type { DeclarativeQueryConfig } from '../../schema'

export const unusedColumnsDeclarative: DeclarativeQueryConfig = {
  name: 'unused-columns',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['type'] },
  description:
    'Columns of one table (set table to database.name) that no finished SELECT in the query log window referenced, largest compressed size first (top 200). This replica only: other replicas and shards keep their own query_log. Unread in the log window is not the same as unused: columns read only through views, materialized views or INSERT ... SELECT, or only by jobs that run less often than the window, can appear here. Queries containing SELECT * are excluded from the read set, so a column read only through SELECT * can look unread. Check log_window_start for how far back the log reaches.',
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
  optional: false,
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
    type: 'colored-badge',
    readable_bytes: 'background-bar',
  },
  defaultParams: { table: '', days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
