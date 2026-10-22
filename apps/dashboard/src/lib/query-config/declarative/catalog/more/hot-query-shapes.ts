import type { DeclarativeQueryConfig } from '../../schema'

export const hotQueryShapesDeclarative: DeclarativeQueryConfig = {
  name: 'hot-query-shapes',
  defaultView: 'auto',
  card: { primary: 'normalized_query_hash' },
  description:
    "The query shapes (normalized_query_hash) of finished SELECTs that read one table (set table to database.name) in the query log window, largest total read bytes first (top 50), with the table's sorting_key and partition_key repeated on each row for comparison. No judgement is made: the sorting key is shown so you can compare it with the sample by eye. THIS REPLICA ONLY: a hash read on another replica or shard is not shown. When a query reads several tables, its read_bytes is split evenly across them, so bytes are an estimate. The sample is the normalized query text (literals replaced), truncated to 300 characters.",
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
  optional: false,
  tableCheck: 'system.query_log',
  sql: `
      WITH
        (
            SELECT any(sorting_key)
            FROM system.tables
            WHERE (concat(database, '.', name) = {table:String})
        ) AS sorting_key,
        (
            SELECT any(partition_key)
            FROM system.tables
            WHERE (concat(database, '.', name) = {table:String})
        ) AS partition_key
      SELECT
          normalized_query_hash,
          count() AS executions,
          sum(read_bytes / length(tables)) AS bytes,
          formatReadableSize(bytes) AS readable_bytes,
          round(bytes * 100.0 / nullIf(max(bytes) OVER (), 0), 2) AS pct_bytes,
          round(quantile(0.5)(query_duration_ms)) AS p50_ms,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms,
          max(event_time) AS last_seen,
          substring(normalizeQuery(any(query)), 1, 300) AS sample,
          sorting_key,
          partition_key
      FROM merge('system', '^query_log')
      WHERE (query_kind = 'Select')
        AND (type = 'QueryFinish')
        AND (arrayExists(t -> replaceAll(t, '\`', '') = {table:String}, tables))
        AND (event_date >= today() - {days:UInt16})
      GROUP BY normalized_query_hash
      ORDER BY bytes DESC
      LIMIT 50`,
  columns: [
    'normalized_query_hash',
    'executions',
    'readable_bytes',
    'p50_ms',
    'p95_ms',
    'last_seen',
    'sample',
    'sorting_key',
    'partition_key',
  ],
  columnFormats: {
    executions: 'number',
    readable_bytes: 'background-bar',
    last_seen: 'related-time',
  },
  defaultParams: { table: '', days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
