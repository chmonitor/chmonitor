import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const mergeCharts: Record<string, ChartQueryBuilder> = {
  /**
   * Merge and PartMutation count over time
   *
   * Primary: Uses system.metric_log for historical data
   * Fallback: Returns current point-in-time values from system.metrics
   *
   * Requires: system.metric_log (ClickHouse 20.5+, configured with <metric_log>)
   *
   * Version variants:
   * - 24.10+: Can use query_metric_log for enhanced metrics
   * - 20.5-24.9: Uses metric_log with standard columns
   * - <20.5: Falls back to system.metrics (point-in-time only)
   */
  'merge-count': ({ interval = 'toStartOfFiveMinutes', lastHours = 12 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           avg(CurrentMetric_Merge) AS avg_CurrentMetric_Merge,
           avg(CurrentMetric_PartMutation) AS avg_CurrentMetric_PartMutation
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.metric_log',
      // metric_log exists from v20.5; older versions fall back to the
      // point-in-time system.metrics. VersionedSql picks the highest `since`
      // <= CH version (first/oldest entry is the unknown-version fallback).
      sql: [
        {
          since: '1.0',
          sql: `
    SELECT
      now() AS event_time,
      toFloat64(value) AS avg_CurrentMetric_Merge,
      0 AS avg_CurrentMetric_PartMutation
    FROM system.metrics
    WHERE metric = 'Merge'
    UNION ALL
    SELECT
      now() AS event_time,
      0 AS avg_CurrentMetric_Merge,
      toFloat64(value) AS avg_CurrentMetric_PartMutation
    FROM system.metrics
    WHERE metric = 'PartMutation'
    ORDER BY event_time
        `,
        },
        {
          since: '20.5',
          sql: `
    SELECT ${applyInterval(interval, 'event_time')},
           avg(CurrentMetric_Merge) AS avg_CurrentMetric_Merge,
           avg(CurrentMetric_PartMutation) AS avg_CurrentMetric_PartMutation
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
        },
      ],
    }
  },

  'merge-avg-duration': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const avgDurationSql = (readable: string) => `
    SELECT
        ${applyInterval(interval, 'event_time')},
        AVG(duration_ms) AS avg_duration_ms,
        ${readable} AS readable_avg_duration_ms,
        bar(avg_duration_ms, 0, MAX(avg_duration_ms) OVER ()) AS bar
    FROM merge('system', '^part_log')
    WHERE toInt8(event_type) = 2
      AND toInt8(merge_reason) = 1
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `
    const legacySql = avgDurationSql(
      "if(avg_duration_ms < 1000, concat(toString(round(avg_duration_ms)), ' milliseconds'), formatReadableTimeDelta(avg_duration_ms / 1000, 'seconds'))"
    )
    return {
      // Use numeric comparison via toInt8() for cross-version/cross-shard compatibility
      // This works when merge() combines tables with different schemas (Int8 vs Enum)
      // MergeParts=2, RegularMerge=1 based on ClickHouse source
      // formatReadableTimeDelta takes a third (minimum_unit) argument only
      // from 24.x; 23.x rejects it, so the fallback prints sub-second
      // averages as plain milliseconds.
      query: legacySql,
      sql: [
        { since: '1.0', sql: legacySql },
        {
          since: '24.3',
          sql: avgDurationSql(
            "formatReadableTimeDelta(avg_duration_ms / 1000, 'seconds', 'milliseconds')"
          ),
        },
      ],
      optional: true,
      tableCheck: 'system.part_log',
    }
  },

  'merge-sum-read-rows': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      // Use numeric comparison via toInt8() for cross-version/cross-shard compatibility
      // MergeParts=2, RegularMerge=1 based on ClickHouse source
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        SUM(read_rows) AS sum_read_rows,
        log10(sum_read_rows) * 100 AS sum_read_rows_scale,
        formatReadableQuantity(sum_read_rows) AS readable_sum_read_rows
    FROM merge('system', '^part_log')
    WHERE toInt8(event_type) = 2
      AND toInt8(merge_reason) = 1
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.part_log',
    }
  },

  'summary-used-by-merges': () => ({
    queries: [
      {
        key: 'used',
        query: `
          SELECT
            SUM(memory_usage) as memory_usage,
            formatReadableSize(memory_usage) as readable_memory_usage
          FROM system.merges
        `,
      },
      {
        key: 'totalMem',
        query: `
          SELECT metric, value as total, formatReadableSize(total) AS readable_total
          FROM system.asynchronous_metrics
          WHERE
              metric = 'CGroupMemoryUsed'
              OR metric = 'OSMemoryTotal'
          ORDER BY metric ASC
          LIMIT 1
        `,
      },
      {
        key: 'rowsReadWritten',
        query: `
          SELECT SUM(rows_read) as rows_read,
                 SUM(rows_written) as rows_written,
                 formatReadableQuantity(rows_read) as readable_rows_read,
                 formatReadableQuantity(rows_written) as readable_rows_written
          FROM system.merges
        `,
      },
      {
        key: 'bytesReadWritten',
        query: `
          SELECT SUM(bytes_read_uncompressed) as bytes_read,
                 SUM(bytes_written_uncompressed) as bytes_written,
                 formatReadableSize(bytes_read) as readable_bytes_read,
                 formatReadableSize(bytes_written) as readable_bytes_written
          FROM system.merges
        `,
      },
    ],
  }),

  /**
   * Part lifecycle — event counts bucketed over time, split into the four
   * lifecycle classes used by the Part Log page (New / Merge / Mutate / Remove).
   *
   * event_type numeric mapping (PartLogElement::Type):
   *   NewPart=1, MergeParts=2, DownloadPart=3, RemovePart=4,
   *   MutatePart=5, MovePart=6, MergePartsStart=7, MutatePartStart=8
   *
   * Uses toInt8() for cross-version / cross-shard compatibility (the column is
   * an Enum8 whose textual values are stable but whose merge() coercion is
   * safest as the underlying integer).
   */
  'part-log-lifecycle': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        countIf(toInt8(event_type) = 1) AS new_parts,
        countIf(toInt8(event_type) IN (2, 7)) AS merges,
        countIf(toInt8(event_type) IN (5, 8)) AS mutations,
        countIf(toInt8(event_type) = 4) AS removals
    FROM system.part_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.part_log',
    }
  },
}
