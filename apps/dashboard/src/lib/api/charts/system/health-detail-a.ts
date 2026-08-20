/**
 * Cluster health check charts (detail variants, part 1: replication/parts/queries/mutations).
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import type { ChartQueryBuilder } from '../types'

import { buildPartsPressureProjectionSql } from '@/lib/health/parts-pressure'
import { buildTtlPartitionHealthDetailSql } from '@/lib/health/ttl-partition-sql'

export const healthDetailACharts: Record<string, ChartQueryBuilder> = {
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

  'health-ttl-partition-health-detail': () => ({
    query: buildTtlPartitionHealthDetailSql({ limit: 20 }),
    optional: true,
    tableCheck: 'system.parts',
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
}
