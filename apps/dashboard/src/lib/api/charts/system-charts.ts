/**
 * System Metrics Charts
 * Charts for CPU, memory, disk, and other system-level metrics
 */

import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { ChartQueryBuilder } from './types'

import {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
} from './types'
import {
  buildPartsPressurePercentSql,
  buildPartsPressureProjectionSql,
} from '@/lib/health/parts-pressure'
import { STUCK_THRESHOLD_SECONDS } from '@/lib/query-config/merges/mutations'

const METRICS_PERMISSION = {
  feature: 'metrics',
} satisfies FeaturePermission

export const systemCharts: Record<string, ChartQueryBuilder> = {
  'memory-usage': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           avg(CurrentMetric_MemoryTracking) AS avg_memory,
           formatReadableSize(avg_memory) AS readable_avg_memory
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'cpu-usage': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
       ${applyInterval(interval, 'event_time')},
       avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000 as avg_cpu
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Memory breakdown (RSS decomposition): approximates where the root memory
  // tracker's bytes are going by subtracting the two biggest known background
  // consumers (mark/uncompressed/query caches, background merges/mutations)
  // from the total tracked memory; the remainder is attributed to
  // queries/other. Primary-key/index memory has no historical time series in
  // ClickHouse (system.parts is a live snapshot only), so it rides along as a
  // constant "current" value repeated across every bucket via a scalar
  // subquery wrapped in any() (required so it's valid alongside the GROUP BY).
  // Row-based (metric, value) source ⇒ a metric name absent on an older
  // ClickHouse version just yields no matching rows (ifNotFinite guards the
  // resulting NaN from an empty avgIf) instead of a SQL error, so this needs
  // no per-column `sql: VersionedSql[]` branching — only the table-existence
  // check below.
  'memory-breakdown': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'CurrentMetric_MemoryTracking'), 0) AS total_memory,
      ifNotFinite(avgIf(value, metric = 'CurrentMetric_MergesMutationsMemoryTracking'), 0) AS merges_memory,
      ifNotFinite(avgIf(value, metric = 'MarkCacheBytes'), 0)
        + ifNotFinite(avgIf(value, metric = 'UncompressedCacheBytes'), 0)
        + ifNotFinite(avgIf(value, metric = 'QueryCacheBytes'), 0) AS caches_memory,
      greatest(total_memory - merges_memory - caches_memory, 0) AS queries_memory,
      any((SELECT sum(primary_key_bytes_in_memory) FROM system.parts WHERE active)) AS primary_key_memory
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN (
      'CurrentMetric_MemoryTracking',
      'CurrentMetric_MergesMutationsMemoryTracking',
      'MarkCacheBytes',
      'UncompressedCacheBytes',
      'QueryCacheBytes'
    )
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Load average (1m/5m/15m) vs core count. Core count is derived (not a
  // single dedicated async metric) by counting the distinct per-core
  // `OSUserTimeCPU{N}` gauges ClickHouse emits — one per logical core.
  'cpu-load-average': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'LoadAverage1'), 0) AS load_average_1m,
      ifNotFinite(avgIf(value, metric = 'LoadAverage5'), 0) AS load_average_5m,
      ifNotFinite(avgIf(value, metric = 'LoadAverage15'), 0) AS load_average_15m,
      uniqExactIf(metric, metric LIKE 'OSUserTimeCPU%') AS cpu_cores
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('LoadAverage1', 'LoadAverage5', 'LoadAverage15')
       OR metric LIKE 'OSUserTimeCPU%'
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // CPU mode split (user/system/iowait/idle), aggregated across all cores.
  // Degrades gracefully (all-zero series → chart empty state) on platforms
  // that don't expose these OS-level asynchronous metrics.
  'cpu-mode-split': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'OSUserTime'), 0) AS user_time,
      ifNotFinite(avgIf(value, metric = 'OSSystemTime'), 0) AS system_time,
      ifNotFinite(avgIf(value, metric = 'OSIOWaitTime'), 0) AS iowait_time,
      ifNotFinite(avgIf(value, metric = 'OSIdleTime'), 0) AS idle_time
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('OSUserTime', 'OSSystemTime', 'OSIOWaitTime', 'OSIdleTime')
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Global thread pool saturation (active vs total threads). Uses
  // `system.metric_log`'s CurrentMetric_* columns, same source/convention as
  // 'memory-usage'/'cpu-usage' above.
  'thread-pool-utilization': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      avg(CurrentMetric_GlobalThreadPoolActiveThreads) AS active_threads,
      avg(CurrentMetric_GlobalThreadPoolThreads) AS total_threads
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'disk-size': ({ params }) => {
    const name = params?.name as string | undefined
    // Sanitize disk name: allow only alphanumeric, underscore, hyphen
    const safeName = name && /^[\w-]+$/.test(name) ? name : undefined
    const condition = safeName ? `WHERE name = '${safeName}'` : ''
    return {
      query: `
    SELECT name,
           type,
           (total_space - unreserved_space) AS used_space,
           formatReadableSize(used_space) AS readable_used_space,
           total_space,
           formatReadableSize(total_space) AS readable_total_space
    FROM system.disks
    ${condition}
    ORDER BY name
  `,
      permission: METRICS_PERMISSION,
    }
  },

  'disks-usage': ({ interval = 'toStartOfDay', lastHours = 24 * 30 }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
    WITH CAST(sumMap(map(metric, value)), 'Map(LowCardinality(String), UInt32)') AS map
    SELECT
        ${applyInterval(interval, 'event_time')},
        map['DiskAvailable_default'] as DiskAvailable_default,
        map['DiskUsed_default'] as DiskUsed_default,
        formatReadableSize(DiskAvailable_default) as readable_DiskAvailable_default,
        formatReadableSize(DiskUsed_default) as readable_DiskUsed_default
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('DiskAvailable_default', 'DiskUsed_default')
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC
  `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'backup-size': ({ lastHours }) => {
    const safeLastHours =
      typeof lastHours === 'number' &&
      Number.isFinite(lastHours) &&
      lastHours > 0
        ? Math.floor(lastHours)
        : undefined
    const startTimeCondition = safeLastHours
      ? `AND start_time > (now() - INTERVAL ${safeLastHours} HOUR)`
      : ''

    return {
      query: `
    SELECT
      SUM(total_size) as total_size,
      SUM(uncompressed_size) as uncompressed_size,
      SUM(compressed_size) as compressed_size,
      formatReadableSize(total_size) as readable_total_size,
      formatReadableSize(uncompressed_size) as readable_uncompressed_size,
      formatReadableSize(compressed_size) as readable_compressed_size
    FROM system.backup_log
    WHERE status = 'BACKUP_CREATED'
          ${startTimeCondition}
  `,
      optional: true,
      tableCheck: 'system.backup_log',
    }
  },

  'new-parts-created': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        count() AS new_parts,
        table,
        sum(rows) AS total_rows,
        formatReadableQuantity(total_rows) AS readable_total_rows,
        sum(size_in_bytes) AS total_bytes_on_disk,
        formatReadableSize(total_bytes_on_disk) AS readable_total_bytes_on_disk
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

  'disk-usage-trend': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        metric,
        avg(value) AS usage
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric LIKE 'DiskUsed_%'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1, metric
    ORDER BY 1 ASC
  `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'disk-usage-by-database': () => ({
    query: `
    SELECT
      database,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size,
      sum(rows) AS total_rows,
      formatReadableQuantity(total_rows) AS readable_rows,
      count() AS part_count
    FROM system.parts
    WHERE active
    GROUP BY database
    ORDER BY total_bytes DESC
  `,
  }),

  'parts-per-table': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      count() AS part_count,
      formatReadableQuantity(part_count) AS readable_part_count,
      sum(rows) AS total_rows,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size
    FROM system.parts
    WHERE active
    GROUP BY database, table
    ORDER BY part_count DESC
    LIMIT 20`,
  }),

  'top-table-size': ({ params }) => {
    const rawLimit = Number(params?.limit)
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100
        ? rawLimit
        : 7
    return {
      query: `
      SELECT
        (database || '.' || table) as table,
        sum(data_compressed_bytes) as compressed_bytes,
        sum(data_uncompressed_bytes) AS uncompressed_bytes,
        formatReadableSize(compressed_bytes) AS compressed,
        formatReadableSize(uncompressed_bytes) AS uncompressed,
        round(uncompressed_bytes / compressed_bytes, 2) AS compr_rate,
        sum(rows) AS total_rows,
        formatReadableQuantity(total_rows) AS readable_total_rows,
        count() AS part_count
    FROM system.parts
    WHERE (active = 1) AND (database != 'system') AND (table LIKE '%')
    GROUP BY 1
    ORDER BY compressed_bytes DESC
    LIMIT ${limit}`,
    }
  },

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

  'data-freshness': () => ({
    query: `
    WITH latest_data AS (
      SELECT
        database,
        table,
        concat(database, '.', table) AS table_path,
        max(modification_time) AS latest_part_time,
        count() AS active_parts,
        sum(rows) AS total_rows,
        dateDiff('second', latest_part_time, now()) AS staleness_seconds
      FROM system.parts
      WHERE active = 1
        AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      GROUP BY database, table
    )
    SELECT
      table_path,
      latest_part_time,
      staleness_seconds,
      formatReadableTimeDelta(staleness_seconds) AS readable_staleness,
      active_parts,
      formatReadableQuantity(total_rows) AS readable_rows
    FROM latest_data
    ORDER BY staleness_seconds DESC, database ASC, table ASC
    LIMIT 20`,
  }),

  'compression-ratio': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      sum(data_compressed_bytes) AS compressed_bytes,
      sum(data_uncompressed_bytes) AS uncompressed_bytes,
      formatReadableSize(compressed_bytes) AS compressed_size,
      formatReadableSize(uncompressed_bytes) AS uncompressed_size,
      round(uncompressed_bytes / nullIf(compressed_bytes, 0), 2) AS compression_ratio,
      formatReadableQuantity(sum(rows)) AS readable_rows
    FROM system.parts
    WHERE active = 1
      AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
    GROUP BY database, table
    HAVING compressed_bytes > 0
    ORDER BY compression_ratio ASC, table_path ASC
    LIMIT 20`,
  }),

  'partition-part-health': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      partition,
      count() AS part_count,
      formatReadableQuantity(part_count) AS readable_part_count,
      sum(rows) AS total_rows,
      formatReadableQuantity(total_rows) AS readable_rows,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size
    FROM system.parts
    WHERE active
      AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    GROUP BY database, table, partition
    HAVING part_count > 50
    ORDER BY part_count DESC
    LIMIT 30
  `,
  }),

  'partition-part-health-summary': () => ({
    query: `
    SELECT
      countIf(active) AS active_parts,
      formatReadableQuantity(active_parts) AS readable_active_parts,
      countIf(NOT active) AS outdated_parts,
      uniqExactIf((database, table, partition), active) AS partitions,
      round(active_parts / nullIf(partitions, 0), 1) AS avg_parts_per_partition
    FROM system.parts
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

  'top-memory-queries': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        normalized_query_hash,
        any(substring(query, 1, 120)) AS query_preview,
        any(query) AS full_query,
        count() AS execution_count,
        max(memory_usage) AS peak_memory,
        formatReadableSize(max(memory_usage)) AS readable_peak_memory,
        avg(memory_usage) AS avg_memory,
        formatReadableSize(avg(memory_usage)) AS readable_avg_memory
      FROM system.query_log
      WHERE type = 'QueryFinish'
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY normalized_query_hash
      ORDER BY peak_memory DESC
      LIMIT 15
    `,
    }
  },

  // NOTE: 'replication-lag' is defined in replication-charts.ts (authoritative)

  'health-readonly-replicas': () => ({
    query: `
    SELECT count() AS readonly_count
    FROM system.replicas
    WHERE is_readonly = 1
  `,
    optional: true,
    tableCheck: 'system.replicas',
  }),

  'health-delayed-inserts': () => ({
    query: `
    SELECT
      value AS delayed_inserts
    FROM system.metrics
    WHERE metric = 'DelayedInserts'
  `,
  }),

  'health-max-part-count': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      partition,
      count() AS part_count
    FROM system.parts
    WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    GROUP BY database, table, partition
    ORDER BY part_count DESC
    LIMIT 1
  `,
  }),

  // Predictive parts pressure: worst partition's fill vs parts_to_throw_insert
  // (%). Higher-is-worse scalar for the health card + alert rule. No part_log
  // dependency — always available.
  'health-parts-pressure': () => ({
    query: buildPartsPressurePercentSql(),
    optional: true,
    tableCheck: 'system.parts',
  }),

  'health-long-running-queries': () => ({
    query: `
    SELECT count() AS long_running
    FROM system.processes
    WHERE elapsed > 60 AND is_initial_query
  `,
  }),

  'health-oom-killed-recent': () => ({
    query: `
    SELECT count() AS oom_count
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
      AND (exception_code = 241 OR exception LIKE '%MEMORY_LIMIT_EXCEEDED%')
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-failed-queries-recent': () => ({
    query: `
    SELECT count() AS failed_count
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-replication-lag': () => ({
    query: `
    SELECT max(absolute_delay) AS max_lag
    FROM system.replicas
  `,
    optional: true,
    tableCheck: 'system.replicas',
  }),

  'health-keeper-exceptions-recent': () => ({
    query: `
    SELECT coalesce(max(value) - min(value), 0) AS exception_count
    FROM merge('system', '^error_log')
    WHERE error = 'KEEPER_EXCEPTION'
      AND event_time > now() - INTERVAL 1 HOUR
  `,
    optional: true,
    tableCheck: 'system.error_log',
  }),

  'health-memory-percent': () => ({
    query: `
    SELECT
      round(
        (
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal')
          - (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryAvailable')
        )
        * 100.0
        / nullIf((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal'), 0),
        1
      ) AS memory_percent
  `,
    optional: true,
    tableCheck: 'system.asynchronous_metrics',
  }),

  'health-disk-percent': () => ({
    query: `
    SELECT round(max((total_space - free_space) * 100.0 / nullIf(total_space, 0)), 1) AS disk_percent
    FROM system.disks
  `,
    optional: true,
    tableCheck: 'system.disks',
  }),

  // New charts for #1911 alert rule types

  'health-failed-mutations': () => ({
    query: `
    SELECT countIf(is_done = 0 AND isNotNull(latest_fail_time)) AS failed_count
    FROM system.mutations
  `,
    optional: true,
    tableCheck: 'system.mutations',
  }),

  'health-stuck-merges': () => ({
    query: `
    SELECT count() AS stuck_count
    FROM system.merges
    WHERE elapsed > 600
  `,
    optional: true,
    tableCheck: 'system.merges',
  }),

  'health-query-timeouts': () => ({
    query: `
    SELECT count() AS timeout_count
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
      AND (exception_code = 159 OR exception LIKE '%TIMEOUT_EXCEEDED%')
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-failed-backups': () => ({
    query: `
    SELECT count() AS failed_count
    FROM system.backup_log
    WHERE event_time > now() - INTERVAL 24 HOUR
      AND status = 'FAILED'
  `,
    optional: true,
    tableCheck: 'system.backup_log',
  }),

  'health-mv-refresh-failures': () => ({
    query: `
    SELECT countIf(status IN ('Error', 'Failed')) AS failed_count
    FROM system.view_refreshes
  `,
    optional: true,
    tableCheck: 'system.view_refreshes',
  }),

  // ---------------------------------------------------------------------------
  // Health drill-down charts. Each returns the *affected rows* behind a health
  // check (the breakdown shown in the detail dialog), as opposed to the scalar
  // aggregate the card headline reads. Fetched on demand when the dialog opens,
  // via the standard /api/v1/charts/$name path (never the batched endpoint).
  // Columns are pre-formatted + snake_case-aliased so the generic ResultTable
  // renders them cleanly without per-card formatting code.
  // ---------------------------------------------------------------------------

  'health-readonly-replicas-detail': () => ({
    query: `
    SELECT
      database,
      table,
      replica_name,
      is_session_expired,
      queue_size,
      substring(zookeeper_exception, 1, 200) AS zookeeper_exception
    FROM system.replicas
    WHERE is_readonly = 1
    ORDER BY database, table
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.replicas',
  }),

  // Shared by both max-parts (breakdown) and delayed-inserts (diagnostic).
  'health-max-part-count-detail': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      partition,
      count() AS parts,
      formatReadableSize(sum(bytes_on_disk)) AS size_on_disk
    FROM system.parts
    WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    GROUP BY database, table, partition
    ORDER BY parts DESC
    LIMIT 20
  `,
    optional: true,
    tableCheck: 'system.parts',
  }),

  // Parts-pressure evidence: per-partition current parts, effective throw/delay
  // limits, net part-growth rate, and projected hours-to-throw. Requires
  // system.part_log for the projection; when it is disabled the dialog shows the
  // empty message (the max-parts breakdown still gives the current counts).
  'health-parts-pressure-detail': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      partition,
      parts,
      throw_limit,
      delay_limit,
      net_parts_per_hour,
      if(is_delaying, 'delaying now', if(isNull(hours_to_throw), 'stable', concat('~', toString(hours_to_throw), 'h to throw'))) AS projection
    FROM (${buildPartsPressureProjectionSql({ limit: 20 })})
  `,
    optional: true,
    tableCheck: 'system.part_log',
  }),

  'health-long-running-queries-detail': () => ({
    query: `
    SELECT
      query_id,
      user,
      round(elapsed, 1) AS elapsed_s,
      formatReadableQuantity(read_rows) AS read_rows,
      formatReadableSize(memory_usage) AS memory,
      substring(replaceRegexpAll(query, '\\\\s+', ' '), 1, 160) AS query
    FROM system.processes
    WHERE elapsed > 60 AND is_initial_query
    ORDER BY elapsed DESC
    LIMIT 50
  `,
  }),

  'health-oom-killed-recent-detail': () => ({
    query: `
    SELECT
      event_time,
      user,
      query_id,
      formatReadableSize(memory_usage) AS peak_memory,
      substring(replaceRegexpAll(query, '\\\\s+', ' '), 1, 160) AS query
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
      AND (exception_code = 241 OR exception LIKE '%MEMORY_LIMIT_EXCEEDED%')
    ORDER BY event_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-failed-queries-recent-detail': () => ({
    query: `
    SELECT
      event_time,
      user,
      exception_code,
      substring(exception, 1, 160) AS exception,
      substring(replaceRegexpAll(query, '\\\\s+', ' '), 1, 120) AS query
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
    ORDER BY event_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-replication-lag-detail': () => ({
    query: `
    SELECT
      database,
      table,
      replica_name,
      absolute_delay AS delay_s,
      queue_size,
      (log_max_index - log_pointer) AS log_entries_behind
    FROM system.replicas
    WHERE absolute_delay > 0 OR queue_size > 0
    ORDER BY absolute_delay DESC, queue_size DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.replicas',
  }),

  'health-keeper-exceptions-detail': () => ({
    query: `
    SELECT
      name AS error,
      value AS total_count,
      last_error_time,
      substring(last_error_message, 1, 300) AS last_error_message
    FROM system.errors
    WHERE name = 'KEEPER_EXCEPTION' AND value > 0
  `,
    optional: true,
    tableCheck: 'system.errors',
  }),

  'health-memory-percent-detail': () => ({
    query: `
    SELECT
      query_id,
      user,
      formatReadableSize(memory_usage) AS memory,
      round(elapsed, 1) AS elapsed_s,
      substring(replaceRegexpAll(query, '\\\\s+', ' '), 1, 140) AS query
    FROM system.processes
    WHERE is_initial_query
    ORDER BY memory_usage DESC
    LIMIT 20
  `,
  }),

  'health-disk-percent-detail': () => ({
    query: `
    SELECT
      name AS disk,
      path,
      formatReadableSize(total_space - free_space) AS used,
      formatReadableSize(total_space) AS total,
      round((total_space - free_space) * 100.0 / nullIf(total_space, 0), 1) AS used_pct
    FROM system.disks
    ORDER BY used_pct DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.disks',
  }),

  'health-failed-mutations-detail': () => ({
    query: `
    SELECT
      database,
      table,
      mutation_id,
      latest_fail_time,
      parts_to_do,
      substring(latest_fail_reason, 1, 240) AS latest_fail_reason
    FROM system.mutations
    WHERE is_done = 0 AND isNotNull(latest_fail_time)
    ORDER BY latest_fail_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.mutations',
  }),

  'health-stuck-merges-detail': () => ({
    query: `
    SELECT
      database,
      table,
      round(elapsed, 0) AS elapsed_s,
      round(progress * 100, 1) AS progress_pct,
      num_parts,
      formatReadableSize(total_size_bytes_compressed) AS merge_size
    FROM system.merges
    WHERE elapsed > 600
    ORDER BY elapsed DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.merges',
  }),

  'health-query-timeouts-detail': () => ({
    query: `
    SELECT
      event_time,
      user,
      round(query_duration_ms / 1000, 1) AS duration_s,
      substring(replaceRegexpAll(query, '\\\\s+', ' '), 1, 160) AS query
    FROM system.query_log
    WHERE event_time > now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
      AND (exception_code = 159 OR exception LIKE '%TIMEOUT_EXCEEDED%')
    ORDER BY event_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  'health-failed-backups-detail': () => ({
    query: `
    SELECT
      event_time,
      name,
      status,
      substring(error, 1, 300) AS error
    FROM system.backup_log
    WHERE event_time > now() - INTERVAL 24 HOUR
      AND status = 'FAILED'
    ORDER BY event_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.backup_log',
  }),

  'health-mv-refresh-failures-detail': () => ({
    query: `
    SELECT
      database,
      view,
      status,
      substring(exception, 1, 300) AS exception
    FROM system.view_refreshes
    WHERE status IN ('Error', 'Failed')
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.view_refreshes',
  }),

  'health-stuck-mutations-detail': () => ({
    query: `
    SELECT
      database,
      table,
      mutation_id,
      parts_to_do,
      formatReadableTimeDelta(now() - create_time) AS age,
      substring(latest_fail_reason, 1, 200) AS latest_fail_reason
    FROM system.mutations
    WHERE is_done = 0 OR isNotNull(latest_fail_time)
    ORDER BY create_time DESC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.mutations',
  }),

  'health-running-mutations-detail': () => ({
    query: `
    SELECT
      database,
      table,
      mutation_id,
      parts_to_do,
      formatReadableTimeDelta(now() - create_time) AS running_for
    FROM system.mutations
    WHERE is_done = 0
    ORDER BY create_time ASC
    LIMIT 50
  `,
    optional: true,
    tableCheck: 'system.mutations',
  }),

  'keeper-requests': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        avg(value) AS avg_value,
        metric
      FROM merge('system', '^asynchronous_metric_log')
      WHERE metric IN ('ZooKeeperRequest', 'ZooKeeperWatch', 'ZooKeeperSession')
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1, metric
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
    }
  },

  'keeper-wait-time': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        sum(ProfileEvent_ZooKeeperWaitMicroseconds) / 1000 AS wait_ms
      FROM merge('system', '^metric_log')
      ${timeFilter ? `WHERE ${timeFilter}` : ''}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.metric_log',
    }
  },

  'disk-io-throughput': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        metric,
        avg(value) AS avg_value
      FROM merge('system', '^asynchronous_metric_log')
      WHERE metric IN ('OSReadBytes', 'OSWriteBytes')
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1, metric
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
    }
  },

  'storage-policies': () => ({
    query: `
    SELECT
      policy_name,
      volume_name,
      disks,
      volume_priority,
      prefer_not_to_merge
    FROM system.storage_policies
    ORDER BY policy_name, volume_priority
  `,
  }),
}
