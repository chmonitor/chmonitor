import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const queryCountBaselineConfig: QueryConfig = {
  name: 'query-count-baseline',
  description: 'Historical query counts for baseline analysis',
  sql: `
    SELECT
      toUnixTimestamp(toStartOfMinute(event_time)) * 1000 as timestamp,
      toStartOfMinute(event_time) as time_bucket,
      count() as query_count
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
    GROUP BY time_bucket
    ORDER BY time_bucket ASC
  `,
  columns: ['timestamp', 'time_bucket', 'query_count'],
  defaultParams: {
    baseline_hours: 24,
  },
  tableCheck: 'system.query_log',
  optional: true,
}

export const memoryUsageBaselineConfig: QueryConfig = {
  name: 'memory-usage-baseline',
  description: 'Historical memory usage for baseline analysis',
  sql: [
    {
      since: '23.8',
      description: 'Memory usage without query_cache_usage',
      sql: `
        SELECT
          toUnixTimestamp(toStartOfFiveMinutes(event_time)) * 1000 as timestamp,
          toStartOfFiveMinutes(event_time) as time_bucket,
          avg(memory_usage) as avg_memory,
          max(memory_usage) as max_memory,
          quantile(0.95)(memory_usage) as p95_memory,
          quantile(0.99)(memory_usage) as p99_memory
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `,
    },
    {
      since: '24.1',
      description: 'Added query_cache_usage column',
      sql: `
        SELECT
          toUnixTimestamp(toStartOfFiveMinutes(event_time)) * 1000 as timestamp,
          toStartOfFiveMinutes(event_time) as time_bucket,
          avg(memory_usage) as avg_memory,
          max(memory_usage) as max_memory,
          quantile(0.95)(memory_usage) as p95_memory,
          quantile(0.99)(memory_usage) as p99_memory,
          avg(CASE WHEN query_cache_usage = 'Read' THEN memory_usage ELSE 0 END) as avg_cache_hit_memory
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `,
    },
  ],
  columns: [
    'timestamp',
    'time_bucket',
    'avg_memory',
    'max_memory',
    'p95_memory',
    'p99_memory',
  ],
  defaultParams: {
    baseline_hours: 24,
  },
  columnFormats: {
    avg_memory: ColumnFormat.NumberShort,
    max_memory: ColumnFormat.NumberShort,
    p95_memory: ColumnFormat.NumberShort,
    p99_memory: ColumnFormat.NumberShort,
  },
  tableCheck: 'system.query_log',
  optional: true,
}

export const mergePerformanceBaselineConfig: QueryConfig = {
  name: 'merge-performance-baseline',
  description: 'Historical merge performance for baseline analysis',
  sql: `
    SELECT
      toUnixTimestamp(toStartOfFiveMinutes(event_time)) * 1000 as timestamp,
      toStartOfFiveMinutes(event_time) as time_bucket,
      avg(duration_ms) / 1000 as avg_elapsed,
      max(duration_ms) / 1000 as max_elapsed,
      quantile(0.95)(duration_ms) / 1000 as p95_elapsed,
      count() as merge_count
    FROM system.part_log
    WHERE event_type = 'MergeParts'
      AND event_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
    GROUP BY time_bucket
    ORDER BY time_bucket ASC
  `,
  columns: [
    'timestamp',
    'time_bucket',
    'avg_elapsed',
    'max_elapsed',
    'p95_elapsed',
    'merge_count',
  ],
  tableCheck: 'system.part_log',
  optional: true,
  defaultParams: {
    baseline_hours: 24,
  },
  columnFormats: {
    avg_elapsed: ColumnFormat.Duration,
    max_elapsed: ColumnFormat.Duration,
    p95_elapsed: ColumnFormat.Duration,
  },
}

export const replicationLagBaselineConfig: QueryConfig = {
  name: 'replication-lag-baseline',
  description: 'Historical replication lag for baseline analysis',
  sql: `
    SELECT
      toUnixTimestamp(toStartOfFiveMinutes(create_time)) * 1000 as timestamp,
      toStartOfFiveMinutes(create_time) as time_bucket,
      avg(dateDiff('second', create_time, now())) as avg_lag,
      max(dateDiff('second', create_time, now())) as max_lag,
      quantile(0.95)(dateDiff('second', create_time, now())) as p95_lag,
      count() as queue_entries
    FROM system.replication_queue
    WHERE create_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
    GROUP BY time_bucket
    ORDER BY time_bucket ASC
  `,
  columns: [
    'timestamp',
    'time_bucket',
    'avg_lag',
    'max_lag',
    'p95_lag',
    'queue_entries',
  ],
  tableCheck: 'system.replication_queue',
  optional: true,
  defaultParams: {
    baseline_hours: 24,
  },
  columnFormats: {
    avg_lag: ColumnFormat.Duration,
    max_lag: ColumnFormat.Duration,
    p95_lag: ColumnFormat.Duration,
  },
}

export const errorRateBaselineConfig: QueryConfig = {
  name: 'error-rate-baseline',
  description: 'Historical error rates for baseline analysis',
  sql: `
    SELECT
      toUnixTimestamp(toStartOfFiveMinutes(event_time)) * 1000 as timestamp,
      toStartOfFiveMinutes(event_time) as time_bucket,
      countIf(type = 'ExceptionBeforeStart' OR type = 'ExceptionWhileProcessing') * 100.0 / count() as error_rate,
      countIf(type = 'ExceptionBeforeStart') * 100.0 / count() as error_before_start_rate,
      countIf(type = 'ExceptionWhileProcessing') * 100.0 / count() as error_while_processing_rate,
      count() as total_queries
    FROM system.query_log
    WHERE type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
      AND event_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
    GROUP BY time_bucket
    ORDER BY time_bucket ASC
  `,
  columns: [
    'timestamp',
    'time_bucket',
    'error_rate',
    'error_before_start_rate',
    'error_while_processing_rate',
    'total_queries',
  ],
  defaultParams: {
    baseline_hours: 24,
  },
  columnFormats: {
    error_rate: ColumnFormat.Number,
    error_before_start_rate: ColumnFormat.Number,
    error_while_processing_rate: ColumnFormat.Number,
  },
  tableCheck: 'system.query_log',
  optional: true,
}

export const diskUsageChangeConfig: QueryConfig = {
  name: 'disk-usage-change',
  description: 'Disk usage changes over time',
  sql: `
    SELECT
      toUnixTimestamp(modification_time) * 1000 as timestamp,
      disk_name,
      database,
      table,
      sum(bytes_on_disk) as total_bytes,
      formatReadableSize(sum(bytes_on_disk)) as readable_size,
      sum(rows) as total_rows
    FROM system.parts
    WHERE active
      AND modification_time >= now() - INTERVAL {baseline_hours: UInt32} HOUR
    GROUP BY disk_name, database, table, modification_time
    ORDER BY modification_time ASC, total_bytes DESC
    LIMIT 10000
  `,
  columns: [
    'timestamp',
    'disk_name',
    'database',
    'table',
    'total_bytes',
    'readable_size',
    'total_rows',
  ],
  defaultParams: {
    baseline_hours: 24,
  },
  columnFormats: {
    total_bytes: ColumnFormat.NumberShort,
    readable_size: ColumnFormat.Text,
    total_rows: ColumnFormat.Number,
  },
}

export const anomalySummaryConfig: QueryConfig = {
  name: 'anomaly-summary',
  description: 'Quick overview of potential anomalies',
  sql: `
    WITH
      -- Current query count (last 5 minutes)
      current_queries AS (
        SELECT count() as cnt
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL 5 MINUTE
      ),
      -- Baseline query count (previous 5 minutes)
      baseline_queries AS (
        SELECT count() as cnt
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL 10 MINUTE
          AND event_time < now() - INTERVAL 5 MINUTE
      ),
      -- Current memory usage
      current_memory AS (
        SELECT avg(memory_usage) as avg_mem
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL 5 MINUTE
      ),
      -- Baseline memory usage
      baseline_memory AS (
        SELECT avg(memory_usage) as avg_mem
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL 10 MINUTE
          AND event_time < now() - INTERVAL 5 MINUTE
      )
    SELECT
      'query_spike' as anomaly_type,
      toFloat64(current_queries.cnt) as current_value,
      toFloat64(baseline_queries.cnt) as baseline_value,
      ((toFloat64(current_queries.cnt) - toFloat64(baseline_queries.cnt)) / toFloat64(baseline_queries.cnt) * 100) as deviation_percent,
      CASE
        WHEN baseline_queries.cnt > 0 AND ((toFloat64(current_queries.cnt) - toFloat64(baseline_queries.cnt)) / toFloat64(baseline_queries.cnt)) > 1 THEN 'critical'
        WHEN baseline_queries.cnt > 0 AND ((toFloat64(current_queries.cnt) - toFloat64(baseline_queries.cnt)) / toFloat64(baseline_queries.cnt)) > 0.5 THEN 'high'
        WHEN baseline_queries.cnt > 0 AND ((toFloat64(current_queries.cnt) - toFloat64(baseline_queries.cnt)) / toFloat64(baseline_queries.cnt)) > 0.25 THEN 'medium'
        ELSE 'normal'
      END as severity
    FROM current_queries, baseline_queries

    UNION ALL

    SELECT
      'memory_anomaly' as anomaly_type,
      current_memory.avg_mem as current_value,
      baseline_memory.avg_mem as baseline_value,
      ((current_memory.avg_mem - baseline_memory.avg_mem) / NULLIF(baseline_memory.avg_mem, 0) * 100) as deviation_percent,
      CASE
        WHEN baseline_memory.avg_mem > 0 AND ((current_memory.avg_mem - baseline_memory.avg_mem) / baseline_memory.avg_mem) > 1 THEN 'critical'
        WHEN baseline_memory.avg_mem > 0 AND ((current_memory.avg_mem - baseline_memory.avg_mem) / baseline_memory.avg_mem) > 0.5 THEN 'high'
        WHEN baseline_memory.avg_mem > 0 AND ((current_memory.avg_mem - baseline_memory.avg_mem) / baseline_memory.avg_mem) > 0.25 THEN 'medium'
        ELSE 'normal'
      END as severity
    FROM current_memory, baseline_memory
  `,
  columns: [
    'anomaly_type',
    'current_value',
    'baseline_value',
    'deviation_percent',
    'severity',
  ],
  columnFormats: {
    current_value: ColumnFormat.Number,
    baseline_value: ColumnFormat.Number,
    deviation_percent: ColumnFormat.Number,
  },
  tableCheck: 'system.query_log',
  optional: true,
}

export const anomalyQueries = [
  queryCountBaselineConfig,
  memoryUsageBaselineConfig,
  mergePerformanceBaselineConfig,
  replicationLagBaselineConfig,
  errorRateBaselineConfig,
  diskUsageChangeConfig,
  anomalySummaryConfig,
] as const satisfies readonly QueryConfig[]
