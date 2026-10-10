/**
 * Built-in Alert Rules
 *
 * Registers all built-in rules into the global ruleRegistry.
 * Call registerBuiltinRules() once at app startup (server-sweep.ts entry).
 *
 * Rules mirror the existing HEALTH_CHECKS where applicable so thresholds are
 * shared. New rule types (failed-mutations, stuck-merges, query-timeout,
 * failed-backups, mv-refresh-failures) extend the engine with rule IDs that
 * the health page does not yet track.
 */

import type { CompoundRuleDef } from './compound-rules'
import type { AlertRuleDef } from './rule-registry'

import {
  buildPartsPressurePercentSql,
  PARTS_PRESSURE_PERCENT_CRITICAL,
  PARTS_PRESSURE_PERCENT_WARNING,
} from '../health/parts-pressure'
import {
  buildTtlPartitionFlaggedCountSql,
  TTL_PARTITION_HEALTH_SETTINGS,
} from '../health/ttl-partition-sql'
import { atLeast, compoundRuleRegistry } from './compound-rules'
import { ruleRegistry } from './rule-registry'

const fmtCount =
  (singular: string, plural?: string) =>
  (v: number | null): string => {
    const n = v ?? 0
    return `${n.toLocaleString()} ${n === 1 ? singular : (plural ?? `${singular}s`)}`
  }

/**
 * All built-in alert rule definitions.
 * Exported so they can be individually imported for tests.
 */
export const BUILTIN_RULES: readonly AlertRuleDef[] = [
  // -------------------------------------------------------------------------
  // Existing health-check parity rules (matching health-checks.ts IDs)
  // -------------------------------------------------------------------------

  {
    id: 'readonly-replicas',
    type: 'readonly-replicas',
    title: 'Readonly Replicas',
    description: 'Replicas in read-only mode cannot accept writes.',
    sql: `SELECT count() AS readonly_count
FROM system.replicas
WHERE is_readonly = 1`,
    valueKey: 'readonly_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('readonly replica'),
    optional: true,
    tableCheck: 'system.replicas',
  },

  {
    id: 'replication-lag',
    type: 'replication-lag',
    title: 'Replication Lag',
    description:
      'Maximum absolute_delay across all replicas (seconds behind leader).',
    sql: `SELECT max(absolute_delay) AS max_lag
FROM system.replicas`,
    valueKey: 'max_lag',
    defaults: { warning: 30, critical: 300 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()}s max delay`,
    optional: true,
    tableCheck: 'system.replicas',
    remediationActions: [
      {
        id: 'replication-lag-runbook',
        label: 'Replication lag runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/replication-lag-runbook',
      },
      {
        id: 'lagging-replicas',
        label: 'Get lagging replicas',
        kind: 'diagnostic',
        description: 'Replicas ordered by absolute_delay, worst first.',
        sql: `SELECT database, table, replica_name, absolute_delay, is_readonly
FROM system.replicas
ORDER BY absolute_delay DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'disk-usage',
    type: 'disk-usage',
    title: 'Disk Usage',
    description: 'Worst-case disk utilization across all configured volumes.',
    sql: `SELECT round(max((total_space - free_space) * 100.0 / nullIf(total_space, 0)), 1) AS disk_percent
FROM system.disks`,
    valueKey: 'disk_percent',
    defaults: { warning: 80, critical: 95 },
    formatLabel: (v) => `${v ?? 0}% used (worst disk)`,
    optional: true,
    tableCheck: 'system.disks',
    // Runbook link only — freeing disk space is a TTL/partition-management
    // decision, never a one-click action from an alert.
    remediationActions: [
      {
        id: 'disk-usage-runbook',
        label: 'Disk usage runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/disk-usage-runbook',
      },
    ],
  },

  {
    id: 'keeper-unavailable',
    type: 'keeper-unavailable',
    title: 'Keeper Exceptions',
    description:
      'Recent KEEPER_EXCEPTION events. Sustained exceptions indicate quorum issues.',
    sql: `SELECT coalesce(max(value) - min(value), 0) AS exception_count
FROM merge('system', '^error_log')
WHERE error = 'KEEPER_EXCEPTION'
  AND event_time > now() - INTERVAL 1 HOUR`,
    valueKey: 'exception_count',
    // Warning starts at 5, not 1: a single KEEPER_EXCEPTION in an hour is
    // routine (session reconnect, leader re-election, a transient network
    // blip) and paged operators for nothing. Sustained exceptions are the
    // quorum signal; 5+ per hour is where that pattern starts.
    defaults: { warning: 5, critical: 20 },
    formatLabel: fmtCount('exception'),
    optional: true,
    tableCheck: 'system.error_log',
  },

  // -------------------------------------------------------------------------
  // New rule types (not yet tracked in HEALTH_CHECKS)
  // -------------------------------------------------------------------------

  {
    id: 'failed-mutations',
    type: 'failed-mutations',
    title: 'Failed Mutations',
    description:
      'Mutations that are not complete and have recorded a failure. Failed mutations block subsequent mutations on the same table.',
    sql: `SELECT countIf(is_done = 0 AND latest_fail_reason != '') AS failed_count
FROM system.mutations`,
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 5 },
    formatLabel: fmtCount('failed mutation'),
    optional: true,
    tableCheck: 'system.mutations',
    remediationActions: [
      {
        id: 'failed-mutations-runbook',
        label: 'Failed mutations runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/failed-mutations-runbook',
      },
      {
        id: 'failed-mutations-detail',
        label: 'Get failed mutations',
        kind: 'diagnostic',
        description: 'Incomplete mutations with a recorded failure.',
        sql: `SELECT database, table, mutation_id, command, latest_fail_reason, latest_fail_time
FROM system.mutations
WHERE is_done = 0 AND latest_fail_reason != ''
ORDER BY latest_fail_time DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'stuck-merges',
    type: 'stuck-merges',
    title: 'Stuck Merges',
    description:
      'Merges running for more than 10 minutes. Stuck merges block table inserts and consume resources.',
    sql: `SELECT count() AS stuck_count
FROM system.merges
WHERE elapsed > 600`,
    valueKey: 'stuck_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('stuck merge'),
    optional: true,
    tableCheck: 'system.merges',
    remediationActions: [
      {
        id: 'stuck-merges-runbook',
        label: 'Stuck merges runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/stuck-merges-runbook',
      },
      {
        id: 'stuck-merges-detail',
        label: 'Get stuck merges',
        kind: 'diagnostic',
        description: 'Merges running longer than 10 minutes, slowest first.',
        sql: `SELECT database, table, elapsed, progress, num_parts, total_size_bytes_compressed
FROM system.merges
WHERE elapsed > 600
ORDER BY elapsed DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'query-timeout',
    type: 'query-timeout',
    title: 'Query Timeout Breaches (1h)',
    description:
      'Queries killed due to timeout (TIMEOUT_EXCEEDED) in the last hour.',
    sql: `SELECT count() AS timeout_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND (exception_code = 159 OR exception LIKE '%TIMEOUT_EXCEEDED%')`,
    valueKey: 'timeout_count',
    defaults: { warning: 1, critical: 10 },
    formatLabel: (v) =>
      `${(v ?? 0).toLocaleString()} timeout kills in last hour`,
    optional: true,
    tableCheck: 'system.query_log',
  },

  {
    id: 'failed-backups',
    type: 'failed-backups',
    title: 'Failed Backups (24h)',
    description:
      'Backup operations that ended in FAILED status in the last 24 hours.',
    sql: `SELECT count() AS failed_count
FROM system.backup_log
WHERE event_time > now() - INTERVAL 24 HOUR
  AND status IN ('BACKUP_FAILED', 'RESTORE_FAILED')`,
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('failed backup'),
    optional: true,
    tableCheck: 'system.backup_log',
  },

  {
    id: 'mv-refresh-failures',
    type: 'mv-refresh-failures',
    title: 'MV Refresh Failures',
    description:
      'Materialized views with REFRESH schedule that have failed or errored their last refresh cycle.',
    sql: `SELECT countIf(exception != '' OR retry > 0) AS failed_count
FROM system.view_refreshes`,
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('failed MV refresh'),
    optional: true,
    tableCheck: 'system.view_refreshes',
  },

  {
    id: 'parts-pressure',
    type: 'parts-pressure',
    title: 'Parts Pressure',
    description:
      'Worst partition’s active parts as a percentage of parts_to_throw_insert. A predictive "too many parts" signal — sustained pressure leads to throttled then rejected inserts.',
    sql: buildPartsPressurePercentSql(),
    valueKey: 'pressure_percent',
    defaults: {
      warning: PARTS_PRESSURE_PERCENT_WARNING,
      critical: PARTS_PRESSURE_PERCENT_CRITICAL,
    },
    formatLabel: (v) => `${v ?? 0}% of parts_to_throw_insert`,
    optional: true,
    tableCheck: 'system.parts',
    remediationActions: [
      {
        id: 'parts-pressure-runbook',
        label: 'Too many parts runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/max-parts-runbook',
      },
      {
        id: 'parts-pressure-detail',
        label: 'Get partitions near the throw limit',
        kind: 'diagnostic',
        description: 'Partitions with the most active parts, worst first.',
        sql: `SELECT database, table, partition, count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY parts DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'ttl-partition-health',
    type: 'ttl-partition-health',
    title: 'TTL & Partition Health',
    description:
      'MergeTree tables with partition bloat, a time-based PARTITION BY and no table TTL, or a merge backlog. Recommend-only — never applies ALTER TTL or DROP PARTITION.',
    sql: buildTtlPartitionFlaggedCountSql(),
    clickhouseSettings: TTL_PARTITION_HEALTH_SETTINGS,
    valueKey: 'flagged_count',
    defaults: { warning: 1, critical: 5 },
    formatLabel: fmtCount('table to review', 'tables to review'),
    optional: true,
    tableCheck: 'system.parts',
    remediationActions: [
      {
        id: 'ttl-partition-health-runbook',
        label: 'TTL & partition workflow',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/dba-workflows',
      },
      {
        id: 'ttl-partition-health-detail',
        label: 'Get tables with 500+ partitions',
        kind: 'diagnostic',
        description:
          'MergeTree-family tables with the most active partitions, worst first.',
        sql: `SELECT
  concat(database, '.', table) AS full_table,
  uniqExact(partition) AS partitions,
  count() AS active_parts
FROM system.parts
WHERE active
GROUP BY database, table
HAVING partitions >= 500
ORDER BY partitions DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'replication-queue-stuck',
    type: 'replication-queue-stuck',
    title: 'Stuck Replication Queue',
    description:
      'Replication queue entries retried more than 100 times or queued for over an hour. A stuck entry stops the replica from catching up and grows replication lag.',
    sql: `SELECT count() AS stuck_count
FROM system.replication_queue
WHERE num_tries > 100 OR create_time < now() - INTERVAL 1 HOUR`,
    valueKey: 'stuck_count',
    defaults: { warning: 1, critical: 10 },
    formatLabel: fmtCount('stuck queue entry', 'stuck queue entries'),
    optional: true,
    tableCheck: 'system.replication_queue',
    remediationActions: [
      {
        id: 'replication-queue-stuck-detail',
        label: 'Get stuck queue entries',
        kind: 'diagnostic',
        description:
          'Oldest queue entries with their retry count and last exception. Fix the cause in last_exception (missing part, disk, Keeper), then let the queue retry.',
        sql: `SELECT database, table, type, create_time, num_tries, last_exception, postpone_reason
FROM system.replication_queue
WHERE num_tries > 100 OR create_time < now() - INTERVAL 1 HOUR
ORDER BY create_time ASC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'replica-session-expired',
    type: 'replica-session-expired',
    title: 'Replica Keeper Session Expired',
    description:
      'Replicated tables whose ZooKeeper/Keeper session has expired. These tables are read-only until the session is re-established — check Keeper health and network to the Keeper ensemble.',
    sql: `SELECT countIf(is_session_expired) AS expired_count
FROM system.replicas`,
    valueKey: 'expired_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('expired replica session'),
    optional: true,
    tableCheck: 'system.replicas',
    remediationActions: [
      {
        id: 'replica-session-expired-detail',
        label: 'Get replicas with an expired session',
        kind: 'diagnostic',
        description: 'Replicated tables whose Keeper session has expired.',
        sql: `SELECT database, table, replica_name, is_readonly, zookeeper_path
FROM system.replicas
WHERE is_session_expired
LIMIT 20`,
      },
    ],
  },

  {
    id: 'delayed-inserts',
    type: 'delayed-inserts',
    title: 'Delayed Inserts',
    description:
      'INSERTs currently throttled because a partition exceeded parts_to_delay_insert. Merges are falling behind inserts — batch inserts into fewer, larger blocks or coarsen PARTITION BY.',
    sql: `SELECT value AS delayed_inserts
FROM system.metrics
WHERE metric = 'DelayedInserts'`,
    valueKey: 'delayed_inserts',
    // Same thresholds as the `delayed-inserts` health check.
    defaults: { warning: 1, critical: 5 },
    formatLabel: fmtCount('delayed insert'),
    optional: true,
    tableCheck: 'system.metrics',
    remediationActions: [
      {
        id: 'delayed-inserts-runbook',
        label: 'Too many parts runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/too-many-parts',
      },
      {
        id: 'delayed-inserts-detail',
        label: 'Get partitions with the most parts',
        kind: 'diagnostic',
        description:
          'DelayedInserts is a global gauge. These partitions carry the most active parts — the likely cause of the throttling.',
        sql: `SELECT database, table, partition, count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY parts DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'rejected-inserts',
    type: 'rejected-inserts',
    title: 'Rejected Inserts (1h)',
    description:
      'INSERTs rejected with TOO_MANY_PARTS in the last hour. Data was not written — the client must retry. Reduce insert frequency or coarsen PARTITION BY.',
    // `system.events.RejectedInserts` is a cumulative counter since server
    // start, so its current value would keep firing long after the incident.
    // The 1h query_log window gives a delta-like signal instead.
    sql: `SELECT count() AS rejected_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')
  AND exception_code = 252`,
    valueKey: 'rejected_count',
    // Any rejected insert is data loss on the client side — critical at 1.
    defaults: { warning: 1, critical: 1 },
    formatLabel: (v) =>
      `${(v ?? 0).toLocaleString()} rejected inserts in last hour`,
    optional: true,
    tableCheck: 'system.query_log',
    remediationActions: [
      {
        id: 'rejected-inserts-runbook',
        label: 'Too many parts runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/too-many-parts',
      },
    ],
  },

  {
    id: 'memory-pressure',
    type: 'memory-pressure',
    title: 'Memory Pressure',
    description:
      'Server memory tracked by ClickHouse (MemoryTracking) as a percentage of host RAM (OSMemoryTotal). Near 100% queries fail with MEMORY_LIMIT_EXCEEDED — find the heaviest queries and cap max_memory_usage.',
    sql: `SELECT round(
  (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking') * 100.0
  / nullIf((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal'), 0),
  1
) AS memory_percent`,
    valueKey: 'memory_percent',
    defaults: { warning: 80, critical: 90 },
    formatLabel: (v) => `${v ?? 0}% of host memory`,
    optional: true,
    tableCheck: 'system.asynchronous_metrics',
    remediationActions: [
      {
        id: 'memory-pressure-runbook',
        label: 'Memory limit runbook',
        kind: 'runbook',
        url: 'https://docs.chmonitor.dev/guide/guides/memory-limit-total-exceeded',
      },
      {
        id: 'memory-pressure-detail',
        label: 'Get top queries by memory',
        kind: 'diagnostic',
        description: 'Running queries using the most memory right now.',
        sql: `SELECT query_id, user, elapsed, formatReadableSize(memory_usage) AS memory, substring(query, 1, 200) AS query
FROM system.processes
ORDER BY memory_usage DESC
LIMIT 20`,
      },
    ],
  },

  {
    id: 'broken-detached-parts',
    type: 'broken-detached-parts',
    title: 'Broken Detached Parts',
    description:
      'Parts ClickHouse detached because they were broken (checksum mismatch, corruption, unexpected files). On a replica the data is usually refetched; on a non-replicated table it may be lost — inspect before dropping.',
    sql: `SELECT count() AS broken_count
FROM system.detached_parts
WHERE reason LIKE 'broken%'`,
    valueKey: 'broken_count',
    // Any broken part is possible data loss — critical at 1.
    defaults: { warning: 1, critical: 1 },
    formatLabel: fmtCount('broken detached part'),
    optional: true,
    tableCheck: 'system.detached_parts',
    remediationActions: [
      {
        id: 'broken-detached-parts-detail',
        label: 'Get broken detached parts',
        kind: 'diagnostic',
        description: 'Detached parts whose reason starts with "broken".',
        sql: `SELECT database, table, name, reason
FROM system.detached_parts
WHERE reason LIKE 'broken%'
ORDER BY database, table, name
LIMIT 50`,
      },
    ],
  },

  {
    id: 'fatal-log-entries',
    type: 'custom',
    title: 'Fatal Log Entries',
    description: 'Fatal errors in the server text log in the last hour.',
    sql: `SELECT count() AS fatal_count
FROM system.text_log
WHERE level = 'Fatal'
  AND event_time >= now() - INTERVAL 1 HOUR`,
    valueKey: 'fatal_count',
    defaults: { warning: 1, critical: 5 },
    formatLabel: (v) => `${v ?? 0} fatal log entries`,
    optional: true,
    tableCheck: 'system.text_log',
  },
]

/**
 * Built-in compound alert rules — correlate ≥2 base rules to cut single-metric
 * false positives. `depends` ids must resolve to `BUILTIN_RULES` ids above.
 * Exported so they can be individually imported for tests.
 */
export const BUILTIN_COMPOUND_RULES: readonly CompoundRuleDef[] = [
  {
    id: 'replica-split-brain',
    title: 'Replica Split-Brain Risk',
    description:
      'Replication lag AND readonly replicas both firing at once — a stronger ' +
      'signal of a stuck/diverging replica than either metric alone.',
    depends: ['replication-lag', 'readonly-replicas'],
    evaluate: (inputs) => {
      const lag = inputs['replication-lag']
      const readonly = inputs['readonly-replicas']
      if (!lag || !readonly) return 'ok'
      const lagFiring = atLeast(lag.severity, 'warning')
      const readonlyFiring = (readonly.value ?? 0) > 0
      if (!lagFiring || !readonlyFiring) return 'ok'
      // Escalate to critical when either input is already critical.
      return lag.severity === 'critical' || readonly.severity === 'critical'
        ? 'critical'
        : 'warning'
    },
    formatLabel: (inputs) => {
      const lag = inputs['replication-lag']?.value ?? 0
      const readonly = inputs['readonly-replicas']?.value ?? 0
      return `${lag.toLocaleString()}s max delay + ${readonly.toLocaleString()} readonly replica(s)`
    },
  },

  {
    id: 'merge-pressure',
    title: 'Merge Pressure',
    description:
      'Stuck merges AND high disk usage both firing at once — merges are ' +
      'likely stalled fighting for disk headroom rather than transient load.',
    depends: ['stuck-merges', 'disk-usage'],
    evaluate: (inputs) => {
      const merges = inputs['stuck-merges']
      const disk = inputs['disk-usage']
      if (!merges || !disk) return 'ok'
      const mergesFiring = atLeast(merges.severity, 'warning')
      const diskFiring = atLeast(disk.severity, 'warning')
      if (!mergesFiring || !diskFiring) return 'ok'
      return merges.severity === 'critical' || disk.severity === 'critical'
        ? 'critical'
        : 'warning'
    },
    formatLabel: (inputs) => {
      const merges = inputs['stuck-merges']?.value ?? 0
      const disk = inputs['disk-usage']?.value ?? 0
      return `${merges.toLocaleString()} stuck merge(s) + ${disk}% disk used`
    },
  },
]

/**
 * Register all built-in rules into the global registry.
 * Safe to call multiple times (idempotent: later call overwrites same ID).
 */
export function registerBuiltinRules(): void {
  for (const rule of BUILTIN_RULES) {
    ruleRegistry.register(rule)
  }
  for (const rule of BUILTIN_COMPOUND_RULES) {
    compoundRuleRegistry.register(rule)
  }
}
