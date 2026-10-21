import type { DeclarativeQueryConfig } from '../../schema'

export const unusedTablesDeclarative: DeclarativeQueryConfig = {
  name: 'unused-tables',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['engine'] },
  description:
    'MergeTree tables with no SELECT in the query log window, largest first (top 200). This replica only: other replicas and shards keep their own query_log. Unread in the log window is not the same as unused: tables read only through views or materialized views, or only by jobs that run less often than the window, can appear here. Check log_window_start for how far back the log reaches.',
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
  optional: false,
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
            SELECT min(event_date)
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
      'link',
      { href: '/table?host=[ctx.hostId]&database=[database]&table=[table]' },
    ],
    engine: 'colored-badge',
    readable_bytes: 'background-bar',
    readable_total_rows: 'background-bar',
  },
  defaultParams: { days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
