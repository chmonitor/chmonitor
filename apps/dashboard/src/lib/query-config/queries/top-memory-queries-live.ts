import { MemoryStickIcon, UserIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Individual (non-grouped) queries — currently running (`system.processes`)
 * unioned with recently finished (`system.query_log`) — ranked by peak
 * memory usage. Distinct from `expensiveQueriesByMemoryConfig`, which groups
 * finished queries by normalized pattern; this table ranks single query
 * executions and includes what's running right now.
 */
export const topMemoryQueriesLiveConfig: QueryConfig = {
  name: 'top-memory-queries-live',
  defaultView: 'auto',
  card: {
    primary: 'query',
    badges: ['status'],
    metrics: ['user', 'elapsed'],
  },
  columnIcons: {
    user: UserIcon,
    readable_memory_usage: MemoryStickIcon,
  },
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'stats',
          columns: [
            {
              key: 'memory_usage',
              label: 'Peak memory',
              readableKey: 'readable_memory_usage',
            },
          ],
        },
        {
          type: 'fields',
          title: 'Details',
          columns: ['user', 'status', 'elapsed'],
        },
        { type: 'code', title: 'Query', column: 'query' },
      ],
    }),
  },
  description:
    'Currently running and recently finished queries, ranked by peak memory usage',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  defaultParams: {
    last_hours: '1',
  },
  filterParamPresets: [
    { name: 'Last 1h', key: 'last_hours', value: '1' },
    { name: 'Last 6h', key: 'last_hours', value: '6' },
    { name: 'Last 24h', key: 'last_hours', value: '24' },
    { name: 'Last 7d', key: 'last_hours', value: '168' },
  ],
  sql: `
    WITH combined AS (
      SELECT
        query_id,
        substr(query, 1, 500) AS query,
        user,
        'running' AS status,
        elapsed,
        memory_usage
      FROM system.processes
      WHERE is_cancelled = 0 AND is_initial_query

      UNION ALL

      SELECT
        query_id,
        substr(query, 1, 500) AS query,
        user,
        'finished' AS status,
        query_duration_ms / 1000 AS elapsed,
        memory_usage
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND is_initial_query
        AND event_time > (now() - interval {last_hours:UInt64} hour)
    )
    SELECT
      query_id,
      query,
      user,
      status,
      round(elapsed, 1) AS elapsed,
      memory_usage,
      formatReadableSize(memory_usage) AS readable_memory_usage,
      round(100 * memory_usage / greatest(max(memory_usage) OVER (), 1)) AS pct_memory_usage
    FROM combined
    WHERE memory_usage > 0
    ORDER BY memory_usage DESC
    LIMIT 200
  `,
  columns: [
    'action',
    'query',
    'status',
    'user',
    'elapsed',
    'readable_memory_usage',
  ],
  columnFormats: {
    action: [ColumnFormat.Action, ['explain-query', 'open-in-explorer']],
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    status: ColumnFormat.ColoredBadge,
    user: ColumnFormat.Badge,
    elapsed: ColumnFormat.Duration,
    readable_memory_usage: ColumnFormat.BackgroundBar,
  },
}
