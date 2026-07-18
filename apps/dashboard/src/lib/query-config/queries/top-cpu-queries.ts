import { CpuIcon, UserIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Individual (non-grouped) queries — currently running (`system.processes`)
 * unioned with recently finished (`system.query_log`) — ranked by total CPU
 * time (`ProfileEvents['UserTimeMicroseconds'] +
 * ProfileEvents['SystemTimeMicroseconds']`). Both source tables carry a
 * `ProfileEvents` map, so the same expression works unmodified on running
 * and finished queries.
 */
export const topCpuQueriesConfig: QueryConfig = {
  name: 'top-cpu-queries',
  defaultView: 'auto',
  card: {
    primary: 'query',
    badges: ['status'],
    metrics: ['user', 'elapsed'],
  },
  columnIcons: {
    user: UserIcon,
    readable_cpu_time_us: CpuIcon,
  },
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'stats',
          columns: [
            {
              key: 'cpu_time_us',
              label: 'CPU time',
              readableKey: 'readable_cpu_time_us',
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
    'Currently running and recently finished queries, ranked by total CPU time (user + system)',
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
        (ProfileEvents['UserTimeMicroseconds'] + ProfileEvents['SystemTimeMicroseconds']) AS cpu_time_us
      FROM system.processes
      WHERE is_cancelled = 0 AND is_initial_query

      UNION ALL

      SELECT
        query_id,
        substr(query, 1, 500) AS query,
        user,
        'finished' AS status,
        query_duration_ms / 1000 AS elapsed,
        (ProfileEvents['UserTimeMicroseconds'] + ProfileEvents['SystemTimeMicroseconds']) AS cpu_time_us
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
      cpu_time_us,
      formatReadableTimeDelta(cpu_time_us / 1000000) AS readable_cpu_time_us,
      round(100 * cpu_time_us / greatest(max(cpu_time_us) OVER (), 1)) AS pct_cpu_time_us
    FROM combined
    WHERE cpu_time_us > 0
    ORDER BY cpu_time_us DESC
    LIMIT 200
  `,
  columns: [
    'action',
    'query',
    'status',
    'user',
    'elapsed',
    'readable_cpu_time_us',
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
    readable_cpu_time_us: ColumnFormat.BackgroundBar,
  },
}
