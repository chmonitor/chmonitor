/**
 * Merge/mutation progress and summary charts.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
  type ChartQueryBuilder,
} from '../types'
import { STUCK_THRESHOLD_SECONDS } from '@/lib/query-config/merges/mutations'

export const mergesCharts: Record<string, ChartQueryBuilder> = {
  'new-parts-created': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    // Only the three columns the stacked bar chart actually plots are selected.
    // The chart previously also received total_rows / total_bytes_on_disk and
    // their formatReadable* twins, none of which any consumer reads — see
    // components/charts/merge/new-parts-created.tsx, which destructures exactly
    // { event_time, table, new_parts }. On the cloud demo those four dead
    // columns were about two thirds of an 88 KB response, and this chart is the
    // largest single endpoint on /overview.
    return {
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        count() AS new_parts,
        table
    FROM system.part_log
    WHERE toInt8(event_type) = 1
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY
        event_time,
        table
    ORDER BY
        event_time ASC,
        table DESC
  `,
    }
  },

  'summary-used-by-running-queries': () => ({
    queries: [
      {
        key: 'main',
        query: `
          SELECT COUNT() as query_count,
                 SUM(memory_usage) as memory_usage,
                 formatReadableSize(memory_usage) as readable_memory_usage
          FROM system.processes
        `,
      },
      {
        key: 'totalMem',
        query: `
          SELECT metric,
                 value as total,
                 formatReadableSize(total) AS readable_total
          FROM system.asynchronous_metrics
          WHERE metric = 'CGroupMemoryUsed'
                OR metric = 'OSMemoryTotal'
          ORDER BY metric ASC
          LIMIT 1
        `,
      },
      {
        key: 'todayQueryCount',
        query: `
          SELECT COUNT() as query_count
          FROM system.query_log
          WHERE type = 'QueryStart'
                AND query_start_time >= today()
        `,
      },
      {
        key: 'rowsReadWritten',
        query: `
          SELECT SUM(read_rows) as rows_read,
                 SUM(written_rows) as rows_written,
                 formatReadableQuantity(rows_read) as readable_rows_read,
                 formatReadableQuantity(rows_written) as readable_rows_written
          FROM system.processes
        `,
      },
    ],
  }),

  'summary-used-by-mutations': () => ({
    query: `
    SELECT COUNT() as running_count
    FROM system.mutations
    WHERE is_done = 0
  `,
  }),

  'summary-stuck-mutations': () => ({
    query: `
    SELECT
      countIf(is_done = 0) AS active,
      countIf(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${STUCK_THRESHOLD_SECONDS}) AS stuck,
      countIf(latest_fail_reason != '') AS failed
    FROM system.mutations
  `,
  }),

  'mutation-progress': () => ({
    query: `
    SELECT
      mutation_id,
      concat(database, '.', table) AS table_path,
      command,
      parts_to_do,
      formatReadableQuantity(parts_to_do) AS readable_parts_to_do,
      if(is_done, 'done', if(parts_to_do = 0, 'waiting', 'running')) AS status,
      dateDiff('second', create_time, now()) AS elapsed_seconds,
      formatReadableTimeDelta(dateDiff('second', create_time, now())) AS readable_elapsed,
      latest_fail_reason
    FROM system.mutations
    WHERE is_done = 0
    ORDER BY create_time ASC
  `,
  }),

  'oom-killed-queries': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        count() AS kill_count,
        formatReadableQuantity(count()) AS readable_count
      FROM system.query_log
      WHERE type = 'ExceptionWhileProcessing'
        AND (exception_code = 241 OR exception LIKE '%MEMORY_LIMIT_EXCEEDED%')
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    }
  },
}
