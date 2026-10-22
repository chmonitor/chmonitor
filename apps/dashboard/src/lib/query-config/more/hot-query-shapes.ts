import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * The query shapes (normalized_query_hash) that read ONE table most, from
 * this replica's system.query_log, next to the table's sorting_key and
 * partition_key so the reader can compare them by eye. Data only: no
 * verdict, no "misses the sort key" flag, no recommendation.
 *
 * `table` is database-qualified (`db.name`). query_log stores table names
 * with backQuoteIfNeed on each part, so backticks are stripped before
 * comparing. read_bytes is per query, so a query that reads N tables has its
 * bytes split evenly across them (`read_bytes / length(tables)`): an
 * estimate, not a per-table measurement. The sample is normalizeQuery text
 * (literals replaced by `?`), truncated server-side; the raw query is never
 * returned. No lambda alias in WITH: the old analyzer cannot see it (#4084).
 *
 * The monitor tags its own queries with a leading QUERY_COMMENT, but no other
 * query_log config filters on it, so none is filtered here either.
 */
export const hotQueryShapesConfig: QueryConfig = {
  name: 'hot-query-shapes',
  defaultView: 'auto',
  card: { primary: 'normalized_query_hash' },
  description:
    "The query shapes (normalized_query_hash) of finished SELECTs that read one table (set table to database.name) in the query log window, largest total read bytes first (top 50), with the table's sorting_key and partition_key repeated on each row for comparison. No judgement is made: the sorting key is shown so you can compare it with the sample by eye. THIS REPLICA ONLY: a hash read on another replica or shard is not shown. When a query reads several tables, its read_bytes is split evenly across them, so bytes are an estimate. The sample is the normalized query text (literals replaced), truncated to 300 characters.",
  docs: QUERY_LOG,
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
    executions: ColumnFormat.Number,
    readable_bytes: ColumnFormat.BackgroundBar,
    last_seen: ColumnFormat.RelatedTime,
  },
  defaultParams: { table: '', days: '30' },
  filterParamPresets: [
    { name: 'Last 7d', key: 'days', value: '7' },
    { name: 'Last 30d', key: 'days', value: '30' },
    { name: 'Last 90d', key: 'days', value: '90' },
  ],
}
