/**
 * Cluster health check charts (summary variants).
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import type { ChartQueryBuilder } from '../types'
import {
  buildPartsPressurePercentSql,
} from '@/lib/health/parts-pressure'

export const healthCharts: Record<string, ChartQueryBuilder> = {
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

}
