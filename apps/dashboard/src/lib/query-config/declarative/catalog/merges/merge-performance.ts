import type { DeclarativeQueryConfig } from '../../schema'

export const mergePerformanceDeclarative: DeclarativeQueryConfig = {
  name: 'merge-performance',
  description: 'Merge performance over day, avg duration, avg rows read',
  // Inlined from table-notes PART_LOG (docs is now a plain string)
  docs: `The required table 'part_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#part-log to ensure the necessary table is available.`,
  tableCheck: 'system.part_log',
  optional: true,
  sql: `
      SELECT
          event_date,
          merge_reason,

          -- Merge Count
          count() AS count,

          -- Merge Duration
          AVG(duration_ms) AS avg_duration_ms,
          formatReadableTimeDelta(avg_duration_ms / 1000, 'minutes', 'milliseconds') AS readable_avg_duration,
          round(100 * avg_duration_ms / nullIf(max(avg_duration_ms) OVER (), 0)) as pct_avg_duration,

          -- Rows Read
          SUM(read_rows) AS sum_read_rows,
          formatReadableQuantity(sum_read_rows) AS readable_sum_read_rows,
          round(100 * sum_read_rows / nullIf(max(sum_read_rows) OVER (), 0)) as pct_sum_read_rows,

          bar(avg_duration_ms, 0, max(avg_duration_ms) OVER (), 30) AS bar_avg_duration,
          bar(sum_read_rows, 0, max(sum_read_rows) OVER (), 30) AS bar_sum_read_rows
      FROM merge('system', '^part_log')
      WHERE toInt8(event_type) = 2
        AND toInt8(merge_reason) = 1
      GROUP BY 1, 2
      ORDER BY 1, 2 ASC
    `,
  columns: [
    'event_date',
    'merge_reason',
    'readable_avg_duration',
    'readable_sum_read_rows',
  ],
  columnFormats: {
    merge_reason: 'colored-badge',
    readable_avg_duration: 'background-bar',
    readable_sum_read_rows: 'background-bar',
  },
  relatedCharts: [
    [
      'merge-avg-duration',
      {
        title: 'Merge Avg Duration',
        lastHours: 720,
      },
    ],
    [
      'merge-sum-read-rows',
      {
        title: 'Merge Total Read Rows',
        lastHours: 720,
      },
    ],
  ],
}
