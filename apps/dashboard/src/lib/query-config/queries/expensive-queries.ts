import { HashIcon, TimerIcon } from 'lucide-react'

import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { createConfigExpandedDetails } from '@/components/data-table/cells/config-expanded-details'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const expensiveQueriesConfig: QueryConfig = {
  name: 'expensive-queries',
  // Query is the hero; the headline cost metrics ride as chips. The 20+ timing
  // and byte-accounting columns are noise on a card, so they're hidden here and
  // surfaced in the expand panel's auto-grid instead.
  defaultView: 'auto',
  card: {
    primary: 'query',
    badges: ['query_cache_usage'],
    metrics: ['cnt', 'queries_duration', 'real_time'],
    hidden: [
      'user_time',
      'system_time',
      'disk_read_time',
      'disk_write_time',
      'network_send_time',
      'network_receive_time',
      'zookeeper_wait_time',
      'os_io_wait_time',
      'os_cpu_wait_time',
      'os_cpu_virtual_time',
      'selected_rows',
      'selected_parts',
      'selected_marks',
      'selected_ranges',
      'read_rows',
      'written_rows',
      'result_rows',
      'read_bytes',
      'written_bytes',
      'result_bytes',
      'selected_bytes',
    ],
  },
  columnIcons: {
    cnt: HashIcon,
    queries_duration: TimerIcon,
    real_time: TimerIcon,
  },
  expandable: {
    renderExpanded: createConfigExpandedDetails({
      primaryColumns: ['action', 'query'],
    }),
  },
  description: 'Most expensive queries finished over the selected time window',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  defaultParams: {
    last_hours: '24',
    // Per-event duration floor (seconds). 0 keeps the default view unchanged —
    // every finished/exception query counts — while letting the user narrow to
    // individually-slow queries via the UI selector.
    min_duration_s: '0',
  },
  filterParamPresets: [
    { name: 'Last 1h', key: 'last_hours', value: '1' },
    { name: 'Last 6h', key: 'last_hours', value: '6' },
    { name: 'Last 24h', key: 'last_hours', value: '24' },
    { name: 'Last 7d', key: 'last_hours', value: '168' },
    { name: 'Last 30d', key: 'last_hours', value: '720' },
    { name: 'Any', key: 'min_duration_s', value: '0' },
    { name: '> 1s', key: 'min_duration_s', value: '1' },
    { name: '> 5s', key: 'min_duration_s', value: '5' },
    { name: '> 30s', key: 'min_duration_s', value: '30' },
    { name: '> 60s', key: 'min_duration_s', value: '60' },
  ],
  sql: [
    {
      since: '23.8',
      sql: `
    WITH base_metrics AS (
        SELECT
            normalized_query_hash,
            replace(substr(argMax(query, utime), 1, 500), '\n', ' ') AS query,
            count() AS cnt,
            sum(query_duration_ms) / 1000 AS queries_duration,
            sum(ProfileEvents['RealTimeMicroseconds']) / 1000000 AS real_time,
            sum(ProfileEvents['UserTimeMicroseconds'] as utime) / 1000000 AS user_time,
            sum(ProfileEvents['SystemTimeMicroseconds']) / 1000000 AS system_time,
            sum(ProfileEvents['DiskReadElapsedMicroseconds']) / 1000000 AS disk_read_time,
            sum(ProfileEvents['DiskWriteElapsedMicroseconds']) / 1000000 AS disk_write_time,
            sum(ProfileEvents['NetworkSendElapsedMicroseconds']) / 1000000 AS network_send_time,
            sum(ProfileEvents['NetworkReceiveElapsedMicroseconds']) / 1000000 AS network_receive_time,
            sum(ProfileEvents['ZooKeeperWaitMicroseconds']) / 1000000 AS zookeeper_wait_time,
            sum(ProfileEvents['OSIOWaitMicroseconds']) / 1000000 AS os_io_wait_time,
            sum(ProfileEvents['OSCPUWaitMicroseconds']) / 1000000 AS os_cpu_wait_time,
            sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS os_cpu_virtual_time,
            formatReadableSize(sum(ProfileEvents['NetworkReceiveBytes'])) AS network_receive_bytes,
            formatReadableSize(sum(ProfileEvents['NetworkSendBytes'])) AS network_send_bytes,
            sum(ProfileEvents['SelectedParts']) as selected_parts,
            sum(ProfileEvents['SelectedRanges']) as selected_ranges,
            sum(ProfileEvents['SelectedMarks']) as selected_marks,
            sum(ProfileEvents['SelectedBytes']) as selected_bytes,
            sum(ProfileEvents['FileOpen']) as file_open,
            sum(ProfileEvents['ZooKeeperTransactions']) as zookeeper_transactions,
            quantile(0.97)(memory_usage) as memory_usage_q97,
            formatReadableSize(memory_usage_q97) as readable_memory_usage_q97,
            sum(ProfileEvents['SelectedRows']) as selected_rows,
            sum(read_rows) AS read_rows,
            sum(written_rows) AS written_rows,
            sum(result_rows) AS result_rows,
            formatReadableSize(sum(read_bytes)) AS read_bytes,
            formatReadableSize(sum(written_bytes)) AS written_bytes,
            formatReadableSize(sum(result_bytes)) AS result_bytes
        FROM merge('system', '^query_log')
        PREWHERE (type IN (2, 4)) AND (event_time > (now() - interval {last_hours:UInt64} hour))
        WHERE query_duration_ms >= {min_duration_s:UInt64} * 1000
        GROUP BY normalized_query_hash
    )
    SELECT
        *,
        round(100 * cnt / max(cnt) OVER ()) AS pct_cnt,
        round(100 * queries_duration / max(queries_duration) OVER ()) AS pct_queries_duration,
        round(100 * memory_usage_q97 / max(memory_usage_q97) OVER ()) AS pct_memory_usage_q97,
        round(100 * read_rows / max(read_rows) OVER ()) AS pct_read_rows,
        round(100 * written_rows / max(written_rows) OVER ()) AS pct_written_rows,
        round(100 * result_rows / max(result_rows) OVER ()) AS pct_result_rows,
        round(100 * selected_rows / max(selected_rows) OVER ()) AS pct_selected_rows,
        round(100 * selected_parts / max(selected_parts) OVER ()) AS pct_selected_parts,
        round(100 * selected_ranges / max(selected_ranges) OVER ()) AS pct_selected_ranges,
        round(100 * selected_marks / max(selected_marks) OVER ()) AS pct_selected_marks
    FROM base_metrics
    ORDER BY user_time DESC
    LIMIT 1000
  `,
      description: 'Base query without query_cache_usage',
    },
    {
      since: '24.1',
      sql: `
    WITH base_metrics AS (
        SELECT
            normalized_query_hash,
            replace(substr(argMax(query, utime), 1, 500), '\n', ' ') AS query,
            argMax(query_cache_usage, utime) AS query_cache_usage,
            count() AS cnt,
            sum(query_duration_ms) / 1000 AS queries_duration,
            sum(ProfileEvents['RealTimeMicroseconds']) / 1000000 AS real_time,
            sum(ProfileEvents['UserTimeMicroseconds'] as utime) / 1000000 AS user_time,
            sum(ProfileEvents['SystemTimeMicroseconds']) / 1000000 AS system_time,
            sum(ProfileEvents['DiskReadElapsedMicroseconds']) / 1000000 AS disk_read_time,
            sum(ProfileEvents['DiskWriteElapsedMicroseconds']) / 1000000 AS disk_write_time,
            sum(ProfileEvents['NetworkSendElapsedMicroseconds']) / 1000000 AS network_send_time,
            sum(ProfileEvents['NetworkReceiveElapsedMicroseconds']) / 1000000 AS network_receive_time,
            sum(ProfileEvents['ZooKeeperWaitMicroseconds']) / 1000000 AS zookeeper_wait_time,
            sum(ProfileEvents['OSIOWaitMicroseconds']) / 1000000 AS os_io_wait_time,
            sum(ProfileEvents['OSCPUWaitMicroseconds']) / 1000000 AS os_cpu_wait_time,
            sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS os_cpu_virtual_time,
            formatReadableSize(sum(ProfileEvents['NetworkReceiveBytes'])) AS network_receive_bytes,
            formatReadableSize(sum(ProfileEvents['NetworkSendBytes'])) AS network_send_bytes,
            sum(ProfileEvents['SelectedParts']) as selected_parts,
            sum(ProfileEvents['SelectedRanges']) as selected_ranges,
            sum(ProfileEvents['SelectedMarks']) as selected_marks,
            sum(ProfileEvents['SelectedBytes']) as selected_bytes,
            sum(ProfileEvents['FileOpen']) as file_open,
            sum(ProfileEvents['ZooKeeperTransactions']) as zookeeper_transactions,
            quantile(0.97)(memory_usage) as memory_usage_q97,
            formatReadableSize(memory_usage_q97) as readable_memory_usage_q97,
            sum(ProfileEvents['SelectedRows']) as selected_rows,
            sum(read_rows) AS read_rows,
            sum(written_rows) AS written_rows,
            sum(result_rows) AS result_rows,
            formatReadableSize(sum(read_bytes)) AS read_bytes,
            formatReadableSize(sum(written_bytes)) AS written_bytes,
            formatReadableSize(sum(result_bytes)) AS result_bytes
        FROM merge('system', '^query_log')
        PREWHERE (type IN (2, 4)) AND (event_time > (now() - interval {last_hours:UInt64} hour))
        WHERE query_duration_ms >= {min_duration_s:UInt64} * 1000
        GROUP BY normalized_query_hash
    )
    SELECT
        *,
        round(100 * cnt / max(cnt) OVER ()) AS pct_cnt,
        round(100 * queries_duration / max(queries_duration) OVER ()) AS pct_queries_duration,
        round(100 * memory_usage_q97 / max(memory_usage_q97) OVER ()) AS pct_memory_usage_q97,
        round(100 * read_rows / max(read_rows) OVER ()) AS pct_read_rows,
        round(100 * written_rows / max(written_rows) OVER ()) AS pct_written_rows,
        round(100 * result_rows / max(result_rows) OVER ()) AS pct_result_rows,
        round(100 * selected_rows / max(selected_rows) OVER ()) AS pct_selected_rows,
        round(100 * selected_parts / max(selected_parts) OVER ()) AS pct_selected_parts,
        round(100 * selected_ranges / max(selected_ranges) OVER ()) AS pct_selected_ranges,
        round(100 * selected_marks / max(selected_marks) OVER ()) AS pct_selected_marks
    FROM base_metrics
    ORDER BY user_time DESC
    LIMIT 1000
  `,
      description: 'Added query_cache_usage column',
    },
    {
      since: '26.6',
      sql: `
    WITH base_metrics AS (
        SELECT
            normalized_query_hash,
            replace(substr(argMax(query, utime), 1, 500), '\n', ' ') AS query,
            argMax(query_cache_usage, utime) AS query_cache_usage,
            argMax(client_agent, utime) AS client_agent,
            count() AS cnt,
            sum(query_duration_ms) / 1000 AS queries_duration,
            sum(ProfileEvents['RealTimeMicroseconds']) / 1000000 AS real_time,
            sum(ProfileEvents['UserTimeMicroseconds'] as utime) / 1000000 AS user_time,
            sum(ProfileEvents['SystemTimeMicroseconds']) / 1000000 AS system_time,
            sum(ProfileEvents['DiskReadElapsedMicroseconds']) / 1000000 AS disk_read_time,
            sum(ProfileEvents['DiskWriteElapsedMicroseconds']) / 1000000 AS disk_write_time,
            sum(ProfileEvents['NetworkSendElapsedMicroseconds']) / 1000000 AS network_send_time,
            sum(ProfileEvents['NetworkReceiveElapsedMicroseconds']) / 1000000 AS network_receive_time,
            sum(ProfileEvents['ZooKeeperWaitMicroseconds']) / 1000000 AS zookeeper_wait_time,
            sum(ProfileEvents['OSIOWaitMicroseconds']) / 1000000 AS os_io_wait_time,
            sum(ProfileEvents['OSCPUWaitMicroseconds']) / 1000000 AS os_cpu_wait_time,
            sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS os_cpu_virtual_time,
            formatReadableSize(sum(ProfileEvents['NetworkReceiveBytes'])) AS network_receive_bytes,
            formatReadableSize(sum(ProfileEvents['NetworkSendBytes'])) AS network_send_bytes,
            sum(ProfileEvents['SelectedParts']) as selected_parts,
            sum(ProfileEvents['SelectedRanges']) as selected_ranges,
            sum(ProfileEvents['SelectedMarks']) as selected_marks,
            sum(ProfileEvents['SelectedBytes']) as selected_bytes,
            sum(ProfileEvents['FileOpen']) as file_open,
            sum(ProfileEvents['ZooKeeperTransactions']) as zookeeper_transactions,
            quantile(0.97)(memory_usage) as memory_usage_q97,
            formatReadableSize(memory_usage_q97) as readable_memory_usage_q97,
            sum(ProfileEvents['SelectedRows']) as selected_rows,
            sum(read_rows) AS read_rows,
            sum(written_rows) AS written_rows,
            sum(result_rows) AS result_rows,
            formatReadableSize(sum(read_bytes)) AS read_bytes,
            formatReadableSize(sum(written_bytes)) AS written_bytes,
            formatReadableSize(sum(result_bytes)) AS result_bytes
        FROM merge('system', '^query_log')
        PREWHERE (type IN (2, 4)) AND (event_time > (now() - interval {last_hours:UInt64} hour))
        WHERE query_duration_ms >= {min_duration_s:UInt64} * 1000
        GROUP BY normalized_query_hash
    )
    SELECT
        *,
        round(100 * cnt / max(cnt) OVER ()) AS pct_cnt,
        round(100 * queries_duration / max(queries_duration) OVER ()) AS pct_queries_duration,
        round(100 * memory_usage_q97 / max(memory_usage_q97) OVER ()) AS pct_memory_usage_q97,
        round(100 * read_rows / max(read_rows) OVER ()) AS pct_read_rows,
        round(100 * written_rows / max(written_rows) OVER ()) AS pct_written_rows,
        round(100 * result_rows / max(result_rows) OVER ()) AS pct_result_rows,
        round(100 * selected_rows / max(selected_rows) OVER ()) AS pct_selected_rows,
        round(100 * selected_parts / max(selected_parts) OVER ()) AS pct_selected_parts,
        round(100 * selected_ranges / max(selected_ranges) OVER ()) AS pct_selected_ranges,
        round(100 * selected_marks / max(selected_marks) OVER ()) AS pct_selected_marks
    FROM base_metrics
    ORDER BY user_time DESC
    LIMIT 1000
  `,
      description: 'Added client_agent column (CH 26.6+)',
    },
  ] as VersionedSql[],
  rowClassName: (row) => {
    // queries_duration is total seconds across all executions
    const duration = Number(row.queries_duration || 0)
    if (duration > 30) return 'bg-red-50 dark:bg-red-950/20'
    if (duration > 5) return 'bg-amber-50 dark:bg-amber-950/20'
    return undefined
  },

  columns: [
    'action',
    'query',
    'query_cache_usage',
    'client_agent',
    'queries_duration',
    'readable_memory_usage_q97',
    'cnt',
    'real_time',
    'user_time',
    'system_time',
    'disk_read_time',
    'disk_write_time',
    'network_send_time',
    'network_receive_time',
    'zookeeper_wait_time',
    'os_io_wait_time',
    'os_cpu_wait_time',
    'os_cpu_virtual_time',
    'selected_rows',
    'selected_parts',
    'selected_marks',
    'selected_ranges',
    'read_rows',
    'written_rows',
    'result_rows',
    'read_bytes',
    'written_bytes',
    'result_bytes',
    'selected_bytes',
  ],
  columnFormats: {
    action: [
      ColumnFormat.Action,
      ['explain-query', 'analyze-with-ai', 'open-in-explorer'],
    ],
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    query_cache_usage: ColumnFormat.ColoredBadge,
    client_agent: ColumnFormat.ColoredBadge,
    cnt: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    queries_duration: ColumnFormat.Duration,
    real_time: ColumnFormat.Duration,
    user_time: ColumnFormat.Duration,
    system_time: ColumnFormat.Duration,
    disk_read_time: ColumnFormat.Duration,
    disk_write_time: ColumnFormat.Duration,
    network_send_time: ColumnFormat.Duration,
    network_receive_time: ColumnFormat.Duration,
    zookeeper_wait_time: ColumnFormat.Duration,
    os_io_wait_time: ColumnFormat.Duration,
    os_cpu_wait_time: ColumnFormat.Duration,
    os_cpu_virtual_time: ColumnFormat.Duration,
    readable_memory_usage_q97: ColumnFormat.BackgroundBar,
    selected_rows: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    selected_marks: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    selected_parts: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    selected_ranges: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    read_rows: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    written_rows: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    result_rows: [ColumnFormat.BackgroundBar, { numberFormat: true }],
  },
  relatedCharts: [['top-query-fingerprints', {}]],
}
