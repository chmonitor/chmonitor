import type { QueryConfig } from '@/types/query-config'

import { PART_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const partLogConfig: QueryConfig = {
  name: 'part-log',
  defaultView: 'auto',
  card: { primary: 'part_name', badges: ['event_type', 'merge_reason'] },
  description:
    'Part lifecycle timeline: creation, merges, mutations, downloads, and removals from system.part_log',
  docs: PART_LOG,
  refreshInterval: 30_000,
  // system.part_log is opt-in and may not exist on every server / version
  optional: true,
  tableCheck: 'system.part_log',
  sql: `
      SELECT
        event_time,
        toUnixTimestamp(event_time) AS event_unixtime,
        event_type,
        database,
        table AS table_name,
        database || '.' || table AS table,
        part_name,
        partition_id,
        merge_reason,
        part_type,
        toUInt32OrZero(splitByChar('_', part_name)[-1]) AS part_level,
        size_in_bytes,
        formatReadableSize(size_in_bytes) AS readable_size,
        round(size_in_bytes * 100.0 / nullIf(max(size_in_bytes) OVER (), 0), 2) AS pct_size,
        rows,
        formatReadableQuantity(rows) AS readable_rows,
        round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
        read_rows,
        duration_ms,
        formatReadableTimeDelta(duration_ms / 1000) AS readable_duration,
        round(duration_ms * 100.0 / nullIf(max(duration_ms) OVER (), 0), 2) AS pct_duration,
        peak_memory_usage,
        formatReadableSize(peak_memory_usage) AS readable_peak_memory,
        error,
        exception
      FROM (
        SELECT
          event_time, event_type, database, table, part_name, partition_id,
          merge_reason, part_type, size_in_bytes, rows, read_rows,
          duration_ms, peak_memory_usage, error, exception
        FROM system.part_log
        WHERE event_date >= toDate(now() - INTERVAL {last_hours:UInt64} HOUR)
          AND event_time > now() - INTERVAL {last_hours:UInt64} HOUR
        ORDER BY event_time DESC
        LIMIT 1000
      )
      ORDER BY event_time DESC
    `,
  defaultParams: { last_hours: '24' },
  filterParamPresets: [
    { name: 'Last 24h', key: 'last_hours', value: '24' },
    { name: 'Last 7d', key: 'last_hours', value: '168' },
    { name: 'Last 30d', key: 'last_hours', value: '720' },
  ],
  columns: [
    'event_time',
    'event_type',
    'table',
    'part_name',
    'partition_id',
    'merge_reason',
    'readable_size',
    'readable_rows',
    'readable_duration',
    'readable_peak_memory',
    'error',
    'exception',
  ],
  columnFormats: {
    event_type: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    merge_reason: ColumnFormat.ColoredBadge,
    readable_size: ColumnFormat.BackgroundBar,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_duration: ColumnFormat.BackgroundBar,
    exception: ColumnFormat.CodeDialog,
  },
  rowClassName: (row) => {
    const error = Number(row.error || 0)
    if (error) return 'bg-red-50 dark:bg-red-950/20'
    return ''
  },
}
