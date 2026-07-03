import type { LucideIcon } from 'lucide-react'
import {
  Clock,
  HardDrive,
  Layers,
  MemoryStick,
  PauseCircle,
  ServerCrash,
  ShieldAlert,
  Timer,
  XCircle,
} from 'lucide-react'

import type { Thresholds } from '@/lib/health/thresholds-storage'

export interface RelatedLink {
  label: string
  /** Internal route. `?host=` is appended automatically. */
  href: string
}

export interface DocsLink {
  label: string
  /** External URL. */
  url: string
}

export interface HealthCheckDef {
  id: string
  title: string
  /** Lucide icon rendered in the card header. */
  icon?: LucideIcon
  chartName: string
  /** Field on first data row to read the numeric value from. */
  valueKey: string
  /** Default warning/critical thresholds. */
  defaults: Thresholds
  /** Human-readable label for the value (lowercase). */
  unit?: string
  /** Format the displayed label. */
  formatLabel?: (value: number | null) => string
  /** Format the displayed value (defaults to toLocaleString). */
  formatValue?: (value: number | null) => string
  /** Short description shown in the detail dialog. */
  description?: string
  /** System tables this check probes — surfaced in the audit prompt. */
  systemTables?: readonly string[]
  /** Likely causes — surfaced in the detail dialog and audit prompt. */
  commonCauses?: readonly string[]
  /** Internal pages relevant to the check. */
  relatedLinks?: readonly RelatedLink[]
  /** External documentation links. */
  docsLinks?: readonly DocsLink[]
  /**
   * The SQL query that computes this check's value. Shown in the detail dialog
   * and embedded in the audit prompt. Kept verbatim in sync with the backing
   * chart query in `lib/api/charts/system-charts.ts` (display-only — importing
   * the chart registry here would cross a layering boundary depcruise enforces).
   */
  sql?: string
  /**
   * Chart name (in the registry) whose query returns the *affected rows* behind
   * this check — the drill-down breakdown shown in the detail dialog (e.g. the
   * individual lagging replicas, not just the max lag). Fetched on demand when
   * the dialog opens. Omit for checks with no meaningful per-row breakdown.
   */
  detailChartName?: string
  /**
   * Heading for the breakdown table. Defaults to "Affected rows". Use a
   * "Likely cause …" heading for checks whose metric is a global scalar with no
   * true per-row source (so the rows are a diagnostic, not the flagged instances).
   */
  detailTitle?: string
  /** One-line caption clarifying what the breakdown rows represent. */
  detailDescription?: string
  /** Message shown when the breakdown query returns no rows. */
  detailEmptyMessage?: string
}

const fmtCount = (singular: string, plural?: string) => (v: number | null) => {
  const n = v ?? 0
  return `${n.toLocaleString()} ${n === 1 ? singular : (plural ?? `${singular}s`)}`
}

export const HEALTH_CHECKS: readonly HealthCheckDef[] = [
  {
    id: 'readonly-replicas',
    title: 'Readonly Replicas',
    icon: ShieldAlert,
    chartName: 'health-readonly-replicas',
    detailChartName: 'health-readonly-replicas-detail',
    detailEmptyMessage:
      'No readonly replicas — every replica is accepting writes.',
    valueKey: 'readonly_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('readonly replica'),
    description:
      'Replicas in read-only mode cannot accept writes. Typical causes are ZooKeeper/Keeper connectivity loss or replica metadata corruption.',
    systemTables: ['system.replicas', 'system.replication_queue'],
    commonCauses: [
      'ZooKeeper / ClickHouse Keeper unavailable or laggy',
      'Replica metadata corruption (force_restore_data required)',
      'Disk full on the replica',
    ],
    relatedLinks: [
      { label: 'Readonly Tables', href: '/readonly-tables' },
      { label: 'Replicas', href: '/replicas' },
      { label: 'Replication Queue', href: '/replication-queue' },
    ],
    docsLinks: [
      {
        label: 'system.replicas',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/replicas',
      },
      {
        label: 'Data Replication',
        url: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication',
      },
    ],
    sql: `SELECT count() AS readonly_count
FROM system.replicas
WHERE is_readonly = 1`,
  },
  {
    id: 'delayed-inserts',
    title: 'Delayed Inserts',
    icon: PauseCircle,
    chartName: 'health-delayed-inserts',
    detailChartName: 'health-max-part-count-detail',
    detailTitle: 'Likely cause: partitions with the most parts',
    detailDescription:
      '`DelayedInserts` is a global gauge with no per-row source. These partitions carry the most active parts — the pressure that makes the MergeTree throttle inserts.',
    valueKey: 'delayed_inserts',
    defaults: { warning: 1, critical: 5 },
    formatLabel: fmtCount('delayed insert'),
    description:
      'INSERTs are being throttled because partitions have too many parts. The MergeTree throttles writes once `parts_to_delay_insert` is exceeded.',
    systemTables: ['system.metrics', 'system.parts'],
    commonCauses: [
      'Too-small batches producing many parts (recommend ≥ 1000 rows / insert)',
      'Background merges starved (low background pool size, slow disk)',
      '`parts_to_delay_insert` / `parts_to_throw_insert` tuned too low',
    ],
    relatedLinks: [
      { label: 'Tables Overview', href: '/tables-overview' },
      { label: 'Merges', href: '/merges' },
      { label: 'Merge Performance', href: '/merge-performance' },
    ],
    docsLinks: [
      {
        label: 'MergeTree settings (parts_to_delay_insert)',
        url: 'https://clickhouse.com/docs/en/operations/settings/merge-tree-settings#parts-to-delay-insert',
      },
    ],
    sql: `SELECT value AS delayed_inserts
FROM system.metrics
WHERE metric = 'DelayedInserts'`,
  },
  {
    id: 'max-parts',
    title: 'Max Parts / Partition',
    icon: Layers,
    chartName: 'health-max-part-count',
    detailChartName: 'health-max-part-count-detail',
    detailTitle: 'Partitions by active part count',
    detailEmptyMessage: 'No user partitions found.',
    valueKey: 'part_count',
    defaults: { warning: 150, critical: 300 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()} parts (max partition)`,
    description:
      'A high active part count in a single partition signals that background merges are not keeping up with inserts. Sustained pressure leads to throttled then rejected inserts.',
    systemTables: ['system.parts', 'system.merges'],
    commonCauses: [
      'Frequent small inserts (no batching)',
      'Partition key too granular (e.g., per-hour partitions)',
      'Insufficient background_pool_size or slow storage',
    ],
    relatedLinks: [
      { label: 'Merges', href: '/merges' },
      { label: 'Tables Overview', href: '/tables-overview' },
      { label: 'Mutations', href: '/mutations' },
    ],
    docsLinks: [
      {
        label: 'system.parts',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/parts',
      },
      {
        label: 'Custom Partitioning Key',
        url: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/custom-partitioning-key',
      },
    ],
    sql: `SELECT
  concat(database, '.', table) AS table_path,
  partition,
  count() AS part_count
FROM system.parts
WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
GROUP BY database, table, partition
ORDER BY part_count DESC
LIMIT 1`,
  },
  {
    id: 'long-running-queries',
    title: 'Long-Running Queries',
    icon: Timer,
    chartName: 'health-long-running-queries',
    detailChartName: 'health-long-running-queries-detail',
    detailEmptyMessage: 'No initial queries have been running longer than 60s.',
    valueKey: 'long_running',
    defaults: { warning: 1, critical: 5 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()} queries > 60s`,
    description:
      'Initial queries running for more than 60 seconds. Heavy aggregations, missing indexes, or runaway queries are common offenders.',
    systemTables: ['system.processes', 'system.query_log'],
    commonCauses: [
      'Missing PRIMARY KEY / sort order for the query pattern',
      'Cross-shard JOINs without distributed_product_mode tuning',
      'Stuck query waiting on lock or external resource',
    ],
    relatedLinks: [
      { label: 'Running Queries', href: '/running-queries' },
      { label: 'Slow Queries', href: '/slow-queries' },
      { label: 'Expensive Queries', href: '/expensive-queries' },
    ],
    docsLinks: [
      {
        label: 'system.processes',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/processes',
      },
      {
        label: 'KILL QUERY',
        url: 'https://clickhouse.com/docs/en/sql-reference/statements/kill',
      },
    ],
    sql: `SELECT count() AS long_running
FROM system.processes
WHERE elapsed > 60 AND is_initial_query`,
  },
  {
    id: 'oom-killed',
    title: 'OOM-Killed Queries (1h)',
    icon: MemoryStick,
    chartName: 'health-oom-killed-recent',
    detailChartName: 'health-oom-killed-recent-detail',
    detailEmptyMessage: 'No OOM-killed queries in the last hour.',
    valueKey: 'oom_count',
    defaults: { warning: 1, critical: 10 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()} OOM kills in last hour`,
    description:
      'Queries that exceeded `max_memory_usage` or hit MEMORY_LIMIT_EXCEEDED. Indicates aggregation/order-by spilling needs tuning or per-user limits are too low.',
    systemTables: ['system.query_log'],
    commonCauses: [
      '`max_memory_usage` set too low for the workload',
      'GROUP BY / DISTINCT / ORDER BY on high-cardinality columns without `max_bytes_before_external_*`',
      'Memory pressure from concurrent queries (lacking quotas)',
    ],
    relatedLinks: [
      { label: 'Failed Queries', href: '/failed-queries' },
      { label: 'Expensive Queries', href: '/expensive-queries' },
      { label: 'Metrics', href: '/metrics' },
    ],
    docsLinks: [
      {
        label: 'Memory Settings (max_memory_usage)',
        url: 'https://clickhouse.com/docs/en/operations/settings/query-complexity#max_memory_usage',
      },
      {
        label: 'External aggregation/sorting',
        url: 'https://clickhouse.com/docs/en/operations/settings/query-complexity#settings-max_bytes_before_external_group_by',
      },
    ],
    sql: `SELECT count() AS oom_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND (exception_code = 241 OR exception LIKE '%MEMORY_LIMIT_EXCEEDED%')`,
  },
  {
    id: 'failed-queries',
    title: 'Failed Queries (1h)',
    icon: XCircle,
    chartName: 'health-failed-queries-recent',
    detailChartName: 'health-failed-queries-recent-detail',
    detailEmptyMessage: 'No failed queries in the last hour.',
    valueKey: 'failed_count',
    defaults: { warning: 10, critical: 100 },
    formatLabel: (v) =>
      `${(v ?? 0).toLocaleString()} failed queries in last hour`,
    description:
      'Recent query failures across all users. A sudden spike often points to a broken client, schema change, or quota/limit hit.',
    systemTables: ['system.query_log', 'system.errors'],
    commonCauses: [
      'Recent schema/DDL change incompatible with existing clients',
      'Quota exceeded or `max_concurrent_queries` reached',
      'Network instability between client and server',
    ],
    relatedLinks: [
      { label: 'Failed Queries', href: '/failed-queries' },
      { label: 'History Queries', href: '/history-queries' },
    ],
    docsLinks: [
      {
        label: 'system.query_log',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
      },
      {
        label: 'system.errors',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/errors',
      },
    ],
    sql: `SELECT count() AS failed_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')`,
  },
  {
    id: 'replication-lag',
    title: 'Replication Lag',
    icon: Clock,
    chartName: 'health-replication-lag',
    detailChartName: 'health-replication-lag-detail',
    detailTitle: 'Lagging replicas',
    detailEmptyMessage: 'No replica is lagging — every table is caught up.',
    valueKey: 'max_lag',
    defaults: { warning: 30, critical: 300 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()}s max delay`,
    description:
      'Maximum `absolute_delay` across all replicas (seconds behind the leader). Sustained lag means readers may see stale data.',
    systemTables: ['system.replicas', 'system.replication_queue'],
    commonCauses: [
      'Slow network or saturated inter-server connections',
      'Large fetch backlog in `replication_queue`',
      'ZooKeeper / Keeper latency',
    ],
    relatedLinks: [
      { label: 'Replicas', href: '/replicas' },
      { label: 'Replication Queue', href: '/replication-queue' },
      { label: 'Clusters', href: '/clusters' },
    ],
    docsLinks: [
      {
        label: 'system.replicas',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/replicas',
      },
      {
        label: 'Replication Troubleshooting',
        url: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication#recovery-after-failures',
      },
    ],
    sql: `SELECT max(absolute_delay) AS max_lag
FROM system.replicas`,
  },
  {
    id: 'keeper-exceptions',
    title: 'Keeper Exceptions (1h)',
    icon: ServerCrash,
    chartName: 'health-keeper-exceptions-recent',
    detailChartName: 'health-keeper-exceptions-detail',
    detailTitle: 'Likely cause: KEEPER_EXCEPTION totals',
    detailDescription:
      '`system.errors` reports a cumulative count since server start (not the last hour) plus the most recent occurrence — Keeper has no per-incident row source.',
    detailEmptyMessage: 'No KEEPER_EXCEPTION recorded on this server.',
    valueKey: 'exception_count',
    defaults: { warning: 1, critical: 20 },
    formatLabel: (v) => `${(v ?? 0).toLocaleString()} exceptions in last hour`,
    description:
      'Recent KEEPER_EXCEPTION events. Sustained exceptions usually indicate quorum issues, network partitions, or overloaded Keeper nodes.',
    systemTables: ['system.error_log', 'system.errors'],
    commonCauses: [
      'Keeper node CPU/disk saturated',
      'Lost quorum / network partition between Keeper hosts',
      'snapshot_distance / reserved_log_items misconfiguration',
    ],
    relatedLinks: [
      { label: 'ZooKeeper', href: '/zookeeper?path=/' },
      { label: 'Clusters', href: '/clusters' },
    ],
    docsLinks: [
      {
        label: 'ClickHouse Keeper',
        url: 'https://clickhouse.com/docs/en/operations/clickhouse-keeper',
      },
    ],
    sql: `SELECT coalesce(max(value) - min(value), 0) AS exception_count
FROM merge('system', '^error_log')
WHERE error = 'KEEPER_EXCEPTION'
  AND event_time > now() - INTERVAL 1 HOUR`,
  },
  {
    id: 'memory-percent',
    title: 'Memory Usage',
    icon: MemoryStick,
    chartName: 'health-memory-percent',
    detailChartName: 'health-memory-percent-detail',
    detailTitle: 'Likely cause: top in-flight queries by memory',
    detailDescription:
      'OS memory is a host-level metric with no per-row source. These are the largest in-flight queries by memory — the biggest process-level consumers (they do not sum to OS memory).',
    detailEmptyMessage: 'No queries are currently running.',
    valueKey: 'memory_percent',
    defaults: { warning: 80, critical: 95 },
    formatLabel: (v) => `${v ?? 0}% of OS memory`,
    formatValue: (v) => (v == null ? '—' : `${v}%`),
    description:
      'OS-level memory utilization on the ClickHouse host. Sustained pressure leads to OOM kills, page-cache eviction, and increased GC pause time.',
    systemTables: ['system.asynchronous_metrics', 'system.processes'],
    commonCauses: [
      'Per-query memory limits set above safe per-host budget',
      'Mark cache / uncompressed cache configured too large',
      'Memory leak in user-defined functions or external dictionaries',
    ],
    relatedLinks: [
      { label: 'Metrics', href: '/metrics' },
      { label: 'Asynchronous Metrics', href: '/asynchronous-metrics' },
      { label: 'Expensive Queries', href: '/expensive-queries' },
    ],
    docsLinks: [
      {
        label: 'system.asynchronous_metrics',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/asynchronous_metrics',
      },
    ],
    sql: `SELECT round(
  (
    (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal')
    - (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryAvailable')
  ) * 100.0
  / nullIf((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal'), 0),
  1
) AS memory_percent`,
  },
  {
    id: 'disk-percent',
    title: 'Disk Usage',
    icon: HardDrive,
    chartName: 'health-disk-percent',
    detailChartName: 'health-disk-percent-detail',
    detailTitle: 'Disks by utilization',
    detailEmptyMessage: 'No disks reported.',
    valueKey: 'disk_percent',
    defaults: { warning: 80, critical: 95 },
    formatLabel: (v) => `${v ?? 0}% used (worst disk)`,
    formatValue: (v) => (v == null ? '—' : `${v}%`),
    description:
      'Worst-case disk utilization across all configured volumes. Hitting 100% halts writes and can prevent merges from completing.',
    systemTables: ['system.disks', 'system.parts'],
    commonCauses: [
      'TTL not applied / partition retention misconfigured',
      'Stuck large merges holding temporary copies',
      'Frozen backups not cleaned up',
    ],
    relatedLinks: [
      { label: 'Disks', href: '/disks' },
      { label: 'Tables Overview', href: '/tables-overview' },
      { label: 'Backups', href: '/backups' },
    ],
    docsLinks: [
      {
        label: 'system.disks',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/disks',
      },
      {
        label: 'Storage Policies & TTL',
        url: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-multiple-volumes',
      },
    ],
    sql: `SELECT round(max((total_space - free_space) * 100.0 / nullIf(total_space, 0)), 1) AS disk_percent
FROM system.disks`,
  },
  {
    id: 'failed-mutations',
    title: 'Failed Mutations',
    icon: XCircle,
    chartName: 'health-failed-mutations',
    detailChartName: 'health-failed-mutations-detail',
    detailEmptyMessage: 'No failed mutations.',
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 5 },
    formatLabel: fmtCount('failed mutation'),
    description:
      'Mutations that are not done and have recorded a failure. Failed mutations block subsequent mutations on the same table.',
    systemTables: ['system.mutations'],
    commonCauses: [
      'Mutation references a column that no longer exists',
      'Disk full on a replica preventing part writes',
      'Hardware / network fault during part rewrite',
    ],
    relatedLinks: [{ label: 'Mutations', href: '/mutations' }],
    docsLinks: [
      {
        label: 'system.mutations',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/mutations',
      },
    ],
    sql: `SELECT countIf(is_done = 0 AND isNotNull(latest_fail_time)) AS failed_count
FROM system.mutations`,
  },
  {
    id: 'stuck-merges',
    title: 'Stuck Merges (>10m)',
    icon: Timer,
    chartName: 'health-stuck-merges',
    detailChartName: 'health-stuck-merges-detail',
    detailEmptyMessage: 'No merges have been running longer than 10 minutes.',
    valueKey: 'stuck_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('stuck merge'),
    description:
      'Merges that have been running for more than 10 minutes. Stuck merges hold disk space, consume background threads, and can block inserts.',
    systemTables: ['system.merges'],
    commonCauses: [
      'Very large parts requiring many hours to merge',
      'Disk I/O saturation or slow storage',
      'Insufficient background_pool_size',
    ],
    relatedLinks: [{ label: 'Merges', href: '/merges' }],
    docsLinks: [
      {
        label: 'system.merges',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/merges',
      },
    ],
    sql: `SELECT count() AS stuck_count
FROM system.merges
WHERE elapsed > 600`,
  },
  {
    id: 'query-timeout',
    title: 'Query Timeout Breaches (1h)',
    icon: Clock,
    chartName: 'health-query-timeouts',
    detailChartName: 'health-query-timeouts-detail',
    detailEmptyMessage: 'No queries hit TIMEOUT_EXCEEDED in the last hour.',
    valueKey: 'timeout_count',
    defaults: { warning: 1, critical: 10 },
    formatLabel: (v) =>
      `${(v ?? 0).toLocaleString()} timeout kills in last hour`,
    description:
      'Queries terminated by TIMEOUT_EXCEEDED in the last hour. Frequent timeouts may indicate missing indexes, under-provisioned resources, or runaway queries.',
    systemTables: ['system.query_log'],
    commonCauses: [
      'max_execution_time set too low for heavy analytical queries',
      'Missing sort key for the filter predicate',
      'Cross-shard queries without proper distribution settings',
    ],
    relatedLinks: [
      { label: 'Failed Queries', href: '/failed-queries' },
      { label: 'Slow Queries', href: '/slow-queries' },
    ],
    docsLinks: [
      {
        label: 'max_execution_time',
        url: 'https://clickhouse.com/docs/en/operations/settings/query-complexity#max-execution-time',
      },
    ],
    sql: `SELECT count() AS timeout_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND (exception_code = 159 OR exception LIKE '%TIMEOUT_EXCEEDED%')`,
  },
  {
    id: 'failed-backups',
    title: 'Failed Backups (24h)',
    icon: HardDrive,
    chartName: 'health-failed-backups',
    detailChartName: 'health-failed-backups-detail',
    detailEmptyMessage: 'No failed backups in the last 24 hours.',
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('failed backup'),
    description:
      'Backup operations that ended in FAILED status in the last 24 hours.',
    systemTables: ['system.backup_log'],
    commonCauses: [
      'Remote storage unavailable or credentials expired',
      'Disk full on backup destination',
      'Network interruption during backup transfer',
    ],
    relatedLinks: [{ label: 'Backups', href: '/backups' }],
    docsLinks: [
      {
        label: 'system.backup_log',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/backup_log',
      },
    ],
    sql: `SELECT count() AS failed_count
FROM system.backup_log
WHERE event_time > now() - INTERVAL 24 HOUR
  AND status = 'FAILED'`,
  },
  {
    id: 'mv-refresh-failures',
    title: 'MV Refresh Failures',
    icon: ShieldAlert,
    chartName: 'health-mv-refresh-failures',
    detailChartName: 'health-mv-refresh-failures-detail',
    detailEmptyMessage: 'No materialized views have failed their last refresh.',
    valueKey: 'failed_count',
    defaults: { warning: 1, critical: 3 },
    formatLabel: fmtCount('failed MV refresh'),
    description:
      'Materialized views with REFRESH schedule that have failed or errored their last refresh cycle.',
    systemTables: ['system.view_refreshes'],
    commonCauses: [
      'Source table schema changed incompatibly',
      'MV query references a missing table or column',
      'Resource exhaustion during refresh',
    ],
    relatedLinks: [{ label: 'View Refreshes', href: '/view-refreshes' }],
    docsLinks: [
      {
        label: 'system.view_refreshes',
        url: 'https://clickhouse.com/docs/en/operations/system-tables/view_refreshes',
      },
    ],
    sql: `SELECT countIf(status IN ('Error', 'Failed')) AS failed_count
FROM system.view_refreshes`,
  },
] as const
