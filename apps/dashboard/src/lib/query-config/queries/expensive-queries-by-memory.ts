import { HashIcon, UserIcon } from 'lucide-react'

import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const expensiveQueriesByMemoryConfig: QueryConfig = {
  name: 'expensive-queries-by-memory',
  // Query is the hero; total/avg memory are the headline stats in the expand.
  defaultView: 'auto',
  card: {
    primary: 'query',
    badges: ['query_cache_usage'],
    metrics: ['user', 'cnt'],
  },
  columnIcons: {
    user: UserIcon,
    cnt: HashIcon,
  },
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'stats',
          columns: [
            {
              key: 'sum_memory',
              label: 'Total memory',
              readableKey: 'readable_sum_memory',
            },
            {
              key: 'avg_memory',
              label: 'Avg memory',
              readableKey: 'readable_avg_memory',
            },
          ],
        },
        {
          type: 'fields',
          title: 'Details',
          columns: ['user', 'cnt', 'query_cache_usage'],
        },
        { type: 'code', title: 'Query', column: 'query' },
      ],
    }),
  },
  description: 'Most expensive queries by memory over the selected time window',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  defaultParams: {
    last_hours: '24',
    // Minimum per-query memory floor (MiB). 0 keeps the default view unchanged.
    min_memory_mb: '0',
  },
  filterParamPresets: [
    { name: 'Last 1h', key: 'last_hours', value: '1' },
    { name: 'Last 6h', key: 'last_hours', value: '6' },
    { name: 'Last 24h', key: 'last_hours', value: '24' },
    { name: 'Last 7d', key: 'last_hours', value: '168' },
    { name: 'Any', key: 'min_memory_mb', value: '0' },
    { name: '> 128 MB', key: 'min_memory_mb', value: '128' },
    { name: '> 1 GB', key: 'min_memory_mb', value: '1024' },
    { name: '> 4 GB', key: 'min_memory_mb', value: '4096' },
  ],
  sql: [
    {
      since: '23.8',
      sql: `
      SELECT
          substr(query, 1, 500) AS query,
          user,
          count() as cnt,
          sum(memory_usage) AS sum_memory,
          avg(memory_usage) AS avg_memory,
          formatReadableSize(sum_memory) AS readable_sum_memory,
          formatReadableSize(avg_memory) AS readable_avg_memory,
          round(100 * cnt / max(cnt) OVER ()) AS pct_cnt,
          round(100 * sum_memory / max(sum_memory) OVER ()) AS pct_sum_memory,
          round(100 * avg_memory / max(avg_memory) OVER ()) AS pct_avg_memory,
          normalized_query_hash
      FROM system.query_log
      PREWHERE type = 'QueryFinish'
          AND event_time > (now() - interval {last_hours:UInt64} hour)
      WHERE query_kind = 'Select'
          AND memory_usage >= {min_memory_mb:UInt64} * 1024 * 1024
      GROUP BY
          normalized_query_hash,
          query,
          user
      ORDER BY avg_memory DESC
      LIMIT 1000
    `,
      description: 'Base query without query_cache_usage',
    },
    {
      since: '24.1',
      sql: `
      SELECT
          substr(query, 1, 500) AS query,
          query_cache_usage,
          user,
          count() as cnt,
          sum(memory_usage) AS sum_memory,
          avg(memory_usage) AS avg_memory,
          formatReadableSize(sum_memory) AS readable_sum_memory,
          formatReadableSize(avg_memory) AS readable_avg_memory,
          round(100 * cnt / max(cnt) OVER ()) AS pct_cnt,
          round(100 * sum_memory / max(sum_memory) OVER ()) AS pct_sum_memory,
          round(100 * avg_memory / max(avg_memory) OVER ()) AS pct_avg_memory,
          normalized_query_hash
      FROM system.query_log
      PREWHERE type = 'QueryFinish'
          AND event_time > (now() - interval {last_hours:UInt64} hour)
      WHERE query_kind = 'Select'
          AND memory_usage >= {min_memory_mb:UInt64} * 1024 * 1024
      GROUP BY
          normalized_query_hash,
          query,
          query_cache_usage,
          user
      ORDER BY avg_memory DESC
      LIMIT 1000
    `,
      description: 'Added query_cache_usage column',
    },
  ] as VersionedSql[],
  columns: [
    'action',
    'query',
    'query_cache_usage',
    'readable_avg_memory',
    'readable_sum_memory',
    'user',
    'cnt',
  ],
  columnFormats: {
    action: [ColumnFormat.Action, ['explain-query', 'open-in-explorer']],
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    query_cache_usage: ColumnFormat.ColoredBadge,
    user: ColumnFormat.Badge,
    cnt: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    readable_sum_memory: ColumnFormat.BackgroundBar,
    readable_avg_memory: ColumnFormat.BackgroundBar,
  },
}
