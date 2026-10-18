import type { DeclarativeQueryConfig } from '../../schema'

/**
 * Declarative mirror of query-condition-cache.ts
 * system.query_condition_cache — ClickHouse 25.3+
 */
export const queryConditionCacheDeclarative: DeclarativeQueryConfig = {
  name: 'query-condition-cache',
  description:
    'Cached query conditions from system.query_condition_cache (ClickHouse 25.3+)',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_condition_cache',
  optional: true,
  tableCheck: 'system.query_condition_cache',
  defaultView: 'auto',
  card: {
    primary: 'key_hash',
    badges: ['readable_entry_size'],
    metrics: ['entry_size'],
  },
  sql: `
      SELECT
          toString(key_hash) AS key_hash,
          entry_size,
          formatReadableSize(entry_size) AS readable_entry_size,
          round(entry_size * 100.0 / nullIf(max(entry_size) OVER (), 0), 2) AS pct_entry_size,
          matching_marks
      FROM system.query_condition_cache
      ORDER BY entry_size DESC
      LIMIT 1000
    `,
  columns: ['key_hash', 'readable_entry_size', 'matching_marks'],
  columnFormats: {
    readable_entry_size: 'background-bar',
    matching_marks: ['code-dialog', { max_truncate: 120 }],
  },
  expandable: {
    type: 'config-details',
    primaryColumns: ['key_hash', 'readable_entry_size'],
  },
  relatedCharts: [['query-cache', {}]],
}
