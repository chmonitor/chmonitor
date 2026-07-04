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
    defaults: { warning: 1, critical: 20 },
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
    sql: `SELECT countIf(is_done = 0 AND isNotNull(latest_fail_time)) AS failed_count
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
WHERE is_done = 0 AND isNotNull(latest_fail_time)
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
  AND status = 'FAILED'`,
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
    sql: `SELECT countIf(status IN ('Error', 'Failed')) AS failed_count
FROM system.view_refreshes`,
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('failed MV refresh'),
    optional: true,
    tableCheck: 'system.view_refreshes',
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
