import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const topUsageColumnsConfig: QueryConfig = {
  name: 'top-usage-columns',
  defaultView: 'auto',
  card: { primary: 'column' },
  description: 'Most usage columns of table based on system.query_log',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: [
    {
      since: '23.8',
      sql: `
      SELECT
          columns as column,
          count() as count,
          round(100 * count() / nullIf(max(count()) OVER (), 0)) as pct_count
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
          countIf(query_cache_usage = 'Read') as cache_hits,
          countIf(query_cache_usage != 'None' AND query_cache_usage != 'Unknown') as cache_usage,
          round(100 * countIf(query_cache_usage = 'Read') / count(), 2) as cache_hit_rate
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
  ] as VersionedSql[],
  columns: [
    'column',
    'count',
    'pct_count',
    'cache_hits',
    'cache_usage',
    'cache_hit_rate',
  ],
  columnFormats: {
    count: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    pct_count: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    cache_hits: ColumnFormat.Number,
    cache_usage: ColumnFormat.Number,
    cache_hit_rate: [ColumnFormat.BackgroundBar, { numberFormat: true }],
  },
  defaultParams: { table: '' },
}
