/**
 * Advisor auto fine-tune engine — table-level schema rules.
 *
 * Pure functions over `TableProfile[]` + optional `ClusterContext`. Companion
 * to column lint in `schema-rules.ts`. Every finding is recommend-only: `ddl`
 * is inert text (ALTER, CREATE Distributed, or a rebuild comment). Never
 * executes, applies, or rewrites a table in place.
 *
 * Covers the DBA gaps column lint does not: TTL, PARTITION BY bloat, MergeTree
 * vs Replicated on a multi-replica cluster, missing Distributed wrappers, and
 * UUID-leading ORDER BY.
 */

import type { ClusterContext, TableProfile, TuningFinding } from './types'

import {
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'
import {
  evaluateTtlPartitionHealth,
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
} from '@/lib/health/ttl-partition-heuristics'
import { formatBytes } from '@/lib/utils'

function fullTable(t: TableProfile): string {
  return formatQualifiedTable(t.database, t.table)
}

function tableTarget(t: TableProfile): string {
  return `${t.database}.${t.table}`
}

/** Strip one wrapping type modifier, e.g. `Nullable(UUID)` → `UUID`. */
function unwrapType(type: string, wrapper: string): string | null {
  const m = new RegExp(`^${wrapper}\\((.+)\\)$`, 'i').exec(type.trim())
  return m ? m[1].trim() : null
}

export function isDistributedEngine(engine: string): boolean {
  return /^Distributed$/i.test(engine.trim())
}

export function isMergeTreeFamily(engine: string): boolean {
  return /MergeTree$/i.test(engine.trim())
}

/** Replicated* or Shared* (managed cloud) — already replica-aware. */
export function isReplicatedOrShared(engine: string): boolean {
  const e = engine.trim()
  return /^(Replicated|Shared)/i.test(e)
}

export function isSharedEngine(engine: string): boolean {
  return /^Shared/i.test(engine.trim())
}

/**
 * Table TTL is the clause after ` TTL ` in `engine_full`, before SETTINGS.
 * Matches the `/ttl-partition-health` SQL extractor.
 */
export function ttlFromEngineFull(engineFull: string): string {
  const marked = ` ${engineFull} `
  const match = /\sTTL\s/i.exec(marked)
  if (!match || match.index === undefined) return ''
  let rest = marked.slice(match.index + match[0].length).trim()
  rest = rest.replace(/\s+SETTINGS\s+[\s\S]*$/i, '').trim()
  return rest
}

/**
 * Best-effort date/time column from a time-based PARTITION BY expression.
 * `toYYYYMMDD(event_time)` → `event_time`. Returns null for expressions.
 */
export function dateColumnFromPartitionKey(
  partitionKey: string
): string | null {
  const key = partitionKey.trim()
  if (!key) return null
  const match = key.match(
    /\bto(?:YYYYMM(?:DD(?:hhmmss)?)?|StartOf\w+|Date(?:Time)?(?:64)?|Monday|YearWeek|ISOWeek)\s*\(\s*([^,)]+)/i
  )
  if (!match) return null
  const col = match[1].trim().replace(/^`+|`+$/g, '')
  if (!col || col.includes('(')) return null
  return col
}

/** First ORDER BY ident when it is a bare column, not an expression. */
export function firstSortingIdent(sortingKey: string): string | null {
  const first = sortingKey.split(',')[0]?.trim() ?? ''
  if (!first || first.includes('(')) return null
  return first.replace(/^`+|`+$/g, '') || null
}

function isUuidType(type: string): boolean {
  const t = type.trim()
  if (/^UUID$/i.test(t)) return true
  const inner = unwrapType(t, 'Nullable') ?? unwrapType(t, 'LowCardinality')
  return inner ? isUuidType(inner) : false
}

function quoteClusterName(cluster: string): string {
  const trimmed = cluster.trim()
  return `'${trimmed.replace(/'/g, "\\'")}'`
}

function suggestedPartitionBy(partitionKey: string): string {
  const col = dateColumnFromPartitionKey(partitionKey)
  if (col && /toYYYYMMDD|toStartOfDay|toDate\(/i.test(partitionKey)) {
    return `toYYYYMM(${col})`
  }
  if (col && /toStartOfHour|toStartOfMinute/i.test(partitionKey)) {
    return `toStartOfDay(${col})`
  }
  return col ? `toYYYYMM(${col})` : 'toYYYYMM(<date_column>)'
}

function distributedTableName(
  table: TableProfile,
  existing: Set<string>
): string {
  const candidates = table.table.endsWith('_local')
    ? [table.table.slice(0, -'_local'.length), `${table.table}_dist`]
    : [`${table.table}_dist`, `${table.table}_distributed`]
  for (const name of candidates) {
    if (!name) continue
    if (!existing.has(`${table.database}.${name}`)) return name
  }
  return `${table.table}_dist`
}

// ---------------------------------------------------------------------------
// Rule — missing TTL on a time-based PARTITION BY.
// ---------------------------------------------------------------------------

export function ruleMissingTtl(tables: TableProfile[]): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const t of tables) {
    if (isDistributedEngine(t.engine) || !isMergeTreeFamily(t.engine)) continue
    const health = evaluateTtlPartitionHealth({
      database: t.database,
      table: t.table,
      partitionKey: t.partitionKey,
      ttlExpression: t.ttlExpression,
      partitions: t.partitions,
      activeParts: t.activeParts,
    })
    if (!health.flags.includes('missing_ttl')) continue

    const dateCol = dateColumnFromPartitionKey(t.partitionKey)
    const estimatedBytesSaved = Math.round(t.bytesOnDisk * 0.2)
    const ddl = dateCol
      ? `ALTER TABLE ${fullTable(t)} MODIFY TTL ${quoteIdentifier(dateCol)} + INTERVAL 90 DAY;`
      : `-- Add a table TTL once you pick the event-time column, e.g.\n-- ALTER TABLE ${fullTable(t)} MODIFY TTL <date_column> + INTERVAL 90 DAY;`

    findings.push({
      ruleId: 'missing_ttl',
      category: 'schema',
      title: `Add table TTL on ${tableTarget(t)}`,
      target: tableTarget(t),
      rationale: `\`${tableTarget(t)}\` uses a time-based \`PARTITION BY ${t.partitionKey || '∅'}\` with no table TTL. Time-series tables without TTL keep partitions forever and become the usual source of partition bloat.`,
      evidence: `${t.partitions} partitions, ${t.activeParts} active parts, ${formatBytes(t.bytesOnDisk)} on disk. PARTITION BY \`${t.partitionKey}\`.`,
      estimatedBenefit: dateCol
        ? `Estimated: a 90-day TTL can drop aged partitions (a conservative ~${formatBytes(estimatedBytesSaved)} if ~20% of bytes are past retention). This is an ESTIMATE — pick the retention your workload actually needs.`
        : 'Estimated: a TTL lets you DROP old partitions instead of scanning them. Confirm the event-time column before applying.',
      estimatedBytesSaved: dateCol ? estimatedBytesSaved : 0,
      severity: 'medium',
      ddl,
      risk: 'medium',
      riskNote:
        'MODIFY TTL expires parts in the background; rows older than the interval are deleted. Confirm the retention window with the business before running. Recommend-only — this tool never applies the ALTER.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule — too many / high partition counts.
// ---------------------------------------------------------------------------

export function rulePartitionCount(tables: TableProfile[]): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const t of tables) {
    if (isDistributedEngine(t.engine) || !isMergeTreeFamily(t.engine)) continue
    const health = evaluateTtlPartitionHealth({
      database: t.database,
      table: t.table,
      partitionKey: t.partitionKey,
      ttlExpression: t.ttlExpression,
      partitions: t.partitions,
      activeParts: t.activeParts,
    })
    const critical = health.flags.includes('too_many_partitions')
    const high = health.flags.includes('high_partition_count')
    if (!critical && !high) continue

    const suggested = suggestedPartitionBy(t.partitionKey)
    const ruleId = critical ? 'too_many_partitions' : 'high_partition_count'
    findings.push({
      ruleId,
      category: 'schema',
      title: critical
        ? `${tableTarget(t)} has ${t.partitions} partitions (rebuild)`
        : `${tableTarget(t)} has ${t.partitions} partitions`,
      target: tableTarget(t),
      rationale: `MergeTree merges within a partition, not across. More than ~${PARTITION_COUNT_WARNING} active partitions per table slows inserts and merges; ~${PARTITION_COUNT_CRITICAL}+ is a production incident waiting to happen. Daily keys on a long-lived table are the usual cause.`,
      evidence: `${t.partitions} partitions, ${t.activeParts} active parts, PARTITION BY \`${t.partitionKey || '∅'}\`, ${formatBytes(t.bytesOnDisk)} on disk.`,
      estimatedBenefit:
        'Estimated: coarser partitions (monthly instead of daily) cut part count and merge pressure. PARTITION BY cannot be ALTERed in place — this is a rebuild. Benefit is operational, not a byte figure.',
      estimatedBytesSaved: 0,
      severity: critical ? 'high' : 'medium',
      ddl: `-- Rebuild required: PARTITION BY cannot be changed in place.\n-- Suggested: PARTITION BY ${suggested}\n-- CREATE TABLE ${fullTable(t)}_new (...) ENGINE = ${t.engine} PARTITION BY ${suggested} ORDER BY (${t.sortingKey || t.primaryKey || 'tuple()'});`,
      risk: 'high',
      riskNote:
        'Changing PARTITION BY means a new table + copy + swap. Do not DROP the original until the copy is verified. Recommend-only — this tool never rebuilds tables.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule — MergeTree on a multi-replica cluster (should be Replicated / Shared).
// ---------------------------------------------------------------------------

export function ruleNonReplicatedOnCluster(
  tables: TableProfile[],
  cluster: ClusterContext
): TuningFinding[] {
  if (!cluster || cluster.replicaCount < 2) return []
  const findings: TuningFinding[] = []
  for (const t of tables) {
    if (!isMergeTreeFamily(t.engine)) continue
    if (isDistributedEngine(t.engine)) continue
    if (isReplicatedOrShared(t.engine)) continue

    findings.push({
      ruleId: 'non_replicated_on_cluster',
      category: 'schema',
      title: `Use a replicated engine for ${tableTarget(t)}`,
      target: tableTarget(t),
      rationale: `\`${tableTarget(t)}\` is \`${t.engine}\` on cluster \`${cluster.cluster}\` (${cluster.replicaCount} replicas). Non-replicated MergeTree is local to one node — inserts and schema changes do not fan out. Prefer ReplicatedMergeTree (self-hosted) or SharedMergeTree (managed cloud).`,
      evidence: `Engine \`${t.engine}\`, cluster \`${cluster.cluster}\` with ${cluster.replicaCount} replicas, ${formatBytes(t.bytesOnDisk)} on disk.`,
      estimatedBenefit:
        'Estimated: replication (and ON CLUSTER DDL) instead of per-node copies. This is an operational win, not a byte figure.',
      estimatedBytesSaved: 0,
      severity: 'medium',
      ddl: `-- Rebuild required: engine family cannot be ALTERed in place.\n-- Suggested local table on cluster ${quoteClusterName(cluster.cluster)}:\n-- CREATE TABLE ${fullTable(t)} ON CLUSTER ${quoteClusterName(cluster.cluster)} (...)\n-- ENGINE = ReplicatedMergeTree ORDER BY (${t.sortingKey || t.primaryKey || 'tuple()'});`,
      risk: 'high',
      riskNote:
        'Engine changes need a new table + copy. ReplicatedMergeTree also needs ZooKeeper/Keeper paths. Recommend-only — this tool never rebuilds tables.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule — local MergeTree without a Distributed wrapper on a cluster.
// ---------------------------------------------------------------------------

export function ruleMissingDistributed(
  tables: TableProfile[],
  cluster: ClusterContext
): TuningFinding[] {
  if (!cluster || cluster.replicaCount < 2) return []
  const findings: TuningFinding[] = []
  for (const t of tables) {
    if (!isMergeTreeFamily(t.engine)) continue
    if (isDistributedEngine(t.engine) || isSharedEngine(t.engine)) continue
    if (t.table.endsWith('_dist') || t.table.endsWith('_distributed')) continue
    const key = tableTarget(t)
    if (cluster.distributedTargets.has(key)) continue

    const distName = distributedTableName(t, cluster.existingTables)
    const distTable = `${quoteIdentifier(t.database)}.${quoteIdentifier(distName)}`

    findings.push({
      ruleId: 'missing_distributed',
      category: 'schema',
      title: `Add a Distributed table for ${tableTarget(t)}`,
      target: tableTarget(t),
      rationale: `\`${tableTarget(t)}\` is a local ${t.engine} on cluster \`${cluster.cluster}\` with no Distributed wrapper pointing at it. Cluster queries should hit a Distributed table (or use clusterAllReplicas) so reads and writes fan out.`,
      evidence: `No Distributed table targeting ${key}. Cluster \`${cluster.cluster}\` has ${cluster.replicaCount} replicas.`,
      estimatedBenefit:
        'Estimated: one cluster-wide name for reads/writes instead of per-node local tables. Additive CREATE — it does not rewrite the local table.',
      estimatedBytesSaved: 0,
      severity: 'low',
      ddl: `CREATE TABLE ${distTable} AS ${fullTable(t)}\nENGINE = Distributed(${quoteClusterName(cluster.cluster)}, ${quoteClusterName(t.database)}, ${quoteClusterName(t.table)}, rand());`,
      risk: 'low',
      riskNote:
        'CREATE Distributed is additive. Confirm the sharding key (first ORDER BY column vs rand()) matches how you want rows placed. Recommend-only — this tool never creates the table.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule — UUID as the leading ORDER BY column.
// ---------------------------------------------------------------------------

export function ruleUuidLeadingSortKey(
  tables: TableProfile[]
): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const t of tables) {
    if (isDistributedEngine(t.engine) || !isMergeTreeFamily(t.engine)) continue
    const ident = firstSortingIdent(t.sortingKey)
    if (!ident || !isUuidType(t.leadingSortType)) continue

    findings.push({
      ruleId: 'uuid_leading_sort_key',
      category: 'schema',
      title: `Do not lead ORDER BY with UUID on ${tableTarget(t)}`,
      target: tableTarget(t),
      rationale: `\`${ident}\` is \`${t.leadingSortType}\` and is the first ORDER BY column. A leading UUID destroys index locality (random inserts, huge sparse index). Put a low-cardinality dimension or a date first, and keep the UUID later in the key if you still need it.`,
      evidence: `ORDER BY (${t.sortingKey}). Leading column \`${ident}\` type \`${t.leadingSortType}\`.`,
      estimatedBenefit:
        'Estimated: better primary-index locality and smaller part indexes after a rebuild. ORDER BY cannot be ALTERed in place.',
      estimatedBytesSaved: 0,
      severity: 'medium',
      ddl: `-- Rebuild required: ORDER BY cannot be changed in place.\n-- Suggested: put a low-cardinality or date column first, e.g. (tenant_id, event_date, ${ident})\n-- CREATE TABLE ${fullTable(t)}_new (...) ENGINE = ${t.engine} ORDER BY (tenant_id, event_date, ${ident});`,
      risk: 'high',
      riskNote:
        'Changing ORDER BY means a new table + copy + swap. Recommend-only — this tool never rebuilds tables.',
    })
  }
  return findings
}

/** Run every table-level schema rule. */
export function runTableRules(
  tables: TableProfile[],
  cluster: ClusterContext = null
): TuningFinding[] {
  return [
    ...ruleMissingTtl(tables),
    ...rulePartitionCount(tables),
    ...ruleNonReplicatedOnCluster(tables, cluster),
    ...ruleMissingDistributed(tables, cluster),
    ...ruleUuidLeadingSortKey(tables),
  ]
}
