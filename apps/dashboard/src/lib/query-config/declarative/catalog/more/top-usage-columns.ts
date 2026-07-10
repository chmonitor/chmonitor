import type { DeclarativeQueryConfig } from '../../schema'

export const topUsageColumnsDeclarative: DeclarativeQueryConfig = {
  name: 'top-usage-columns',
  defaultView: 'auto',
  card: { primary: 'column' },
  description: 'Most usage columns of table based on system.query_log',
  // Inlined from table-notes QUERY_LOG (docs is now a plain string)
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
  optional: false,
  tableCheck: 'system.query_log',
  sql: [
    {
      since: '23.8',
      sql: `
      SELECT
          columns as column,
          count() as count,
          round(100 * count() / nullIf(max(count()) OVER (), 0)) as pct_count,
          pct_count as pct_pct_count
      FROM merge('system', '^query_log')
      ARRAY JOIN columns
      WHERE (query_kind = 'Select')
        AND (type = 'QueryFinish')
        AND (has(tables, {table: String}))
        AND (positionCaseInsensitive(column, {table:String}) != 0)
      GROUP BY 1
      ORDER BY 2 DESC`,
      description: 'Base query without query_cache_usage',
    },
    {
      since: '24.1',
      sql: `
      SELECT
          columns as column,
          count() as count,
          round(100 * count() / nullIf(max(count()) OVER (), 0)) as pct_count,
          pct_count as pct_pct_count,
          countIf(query_cache_usage = 'Read') as cache_hits,
          countIf(query_cache_usage != 'None' AND query_cache_usage != 'Unknown') as cache_usage,
          round(100 * countIf(query_cache_usage = 'Read') / count(), 2) as cache_hit_rate,
          round(cache_hit_rate, 2) as pct_cache_hit_rate
      FROM merge('system', '^query_log')
      ARRAY JOIN columns
      WHERE (query_kind = 'Select')
        AND (type = 'QueryFinish')
        AND (has(tables, {table: String}))
        AND (positionCaseInsensitive(column, {table:String}) != 0)
      GROUP BY 1
      ORDER BY 2 DESC`,
      description: 'Added query_cache_usage aggregations for cache insights',
      columns: [
        'column',
        'count',
        'pct_count',
        'cache_hits',
        'cache_usage',
        'cache_hit_rate',
      ],
    },
  ],
  columns: [
    'column',
    'count',
    'pct_count',
    'cache_hits',
    'cache_usage',
    'cache_hit_rate',
  ],
  columnFormats: {
    count: ['background-bar', { numberFormat: true }],
    pct_count: ['background-bar', { numberFormat: true }],
    cache_hits: 'number',
    cache_usage: 'number',
    cache_hit_rate: ['background-bar', { numberFormat: true }],
  },
  defaultParams: { table: '' },
}
