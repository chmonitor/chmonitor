/**
 * Cluster health check charts (detail variants, part 2: disk/merges/timeouts/backups).
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import type { ChartQueryBuilder } from '../types'

export const healthDetailBCharts: Record<string, ChartQueryBuilder> = {
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

}
