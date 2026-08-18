/**
 * Engine classification + overview formatting helpers for the Data Explorer.
 *
 * The Overview tab is engine-aware: a Dictionary has no parts, partitions or
 * compression, and a View has no storage at all. Rendering em-dash cards for
 * those metrics is noise, so classify the engine first and pick the card set.
 */

import { formatRelativeTime } from '@/lib/utils/format-relative-time'

export type EngineKind =
  | 'mergetree'
  | 'dictionary'
  | 'view'
  | 'materialized-view'
  | 'log'
  | 'integration'
  | 'other'

const INTEGRATION_ENGINES = new Set([
  'Distributed',
  'Kafka',
  'RabbitMQ',
  'NATS',
  'S3',
  'S3Queue',
  'URL',
  'HDFS',
  'MySQL',
  'PostgreSQL',
  'MongoDB',
  'SQLite',
  'ODBC',
  'JDBC',
  'Redis',
  'DeltaLake',
  'Iceberg',
  'Hudi',
  'File',
  'Merge',
  'Buffer',
])

/** Map a `system.tables.engine` value to a coarse kind. */
export function classifyEngine(engine: string | null | undefined): EngineKind {
  const name = (engine ?? '').trim()
  if (name === '') return 'other'

  if (name === 'Dictionary') return 'dictionary'
  if (name === 'MaterializedView') return 'materialized-view'
  if (name === 'View' || name === 'LiveView' || name === 'WindowView') {
    return 'view'
  }
  // Covers MergeTree, ReplicatedMergeTree, SharedReplacingMergeTree, ...
  if (name.endsWith('MergeTree')) return 'mergetree'
  if (name === 'Log' || name === 'TinyLog' || name === 'StripeLog') return 'log'
  if (INTEGRATION_ENGINES.has(name)) return 'integration'

  return 'other'
}

/** Engines that physically store parts (size / rows / parts / compression). */
export function hasPartStorage(kind: EngineKind): boolean {
  return kind === 'mergetree'
}

/** Human label for the object type, used in headers and empty states. */
export function engineKindLabel(kind: EngineKind): string {
  switch (kind) {
    case 'mergetree':
      return 'Table'
    case 'dictionary':
      return 'Dictionary'
    case 'view':
      return 'View'
    case 'materialized-view':
      return 'Materialized view'
    case 'log':
      return 'Log table'
    case 'integration':
      return 'Integration table'
    default:
      return 'Table'
  }
}

/**
 * Extract the target table of a materialized view from its CREATE statement
 * (`CREATE MATERIALIZED VIEW x TO db.target (...) AS SELECT ...`). Returns
 * null for an inner-table MV (`ENGINE = ...`), which has no explicit target.
 */
export interface DistributedEngine {
  cluster: string
  database: string
  table: string
  shardingKey: string | null
}

/**
 * Parse `ENGINE = Distributed(cluster, db, local_table [, sharding_key])`
 * from `system.tables.engine_full`. Quoted identifiers and string literals
 * are accepted; missing or non-Distributed engines return null.
 */
export function parseDistributedEngine(
  engineFull: string | null | undefined
): DistributedEngine | null {
  if (typeof engineFull !== 'string' || engineFull.trim() === '') return null

  const match = engineFull.match(/Distributed\s*\(([\s\S]*)\)\s*$/i)
  if (!match) return null

  const args = splitEngineArgs(match[1])
  if (args.length < 3) return null

  const cluster = unquoteIdent(args[0])
  const database = unquoteIdent(args[1])
  const table = unquoteIdent(args[2])
  if (!cluster || !database || !table) return null

  const shardingKey = args[3]?.trim() ? args[3].trim() : null
  return { cluster, database, table, shardingKey }
}

function splitEngineArgs(inner: string): string[] {
  const args: string[] = []
  let current = ''
  let depth = 0
  let quote: "'" | '"' | '`' | null = null

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    const prev = i > 0 ? inner[i - 1] : ''

    if (quote) {
      current += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '(') {
      depth += 1
      current += ch
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      current += ch
      continue
    }

    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim()) args.push(current.trim())
  return args
}

function unquoteIdent(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1).replace(/\\(['"`])/g, '$1')
  }
  return value
}

export interface ClusterReplicaRow {
  cluster: string
  shard_num: string | number
}

/** Compact shard × replica note when topology rows exist for the cluster. */
export function formatDistributedTopologyNote(
  dist: DistributedEngine,
  rows: ClusterReplicaRow[] | null | undefined
): string {
  const local = `${dist.database}.${dist.table}`
  const matching = (rows ?? []).filter((row) => row.cluster === dist.cluster)
  if (matching.length === 0) {
    return `Distributed wrapper over local table ${local} on cluster ${dist.cluster}. Apply schema changes on the local table, then keep this Distributed table in sync.`
  }

  const perShard = new Map<string, number>()
  for (const row of matching) {
    const key = String(row.shard_num)
    perShard.set(key, (perShard.get(key) ?? 0) + 1)
  }
  const shards = perShard.size
  const replicas = Math.max(...perShard.values())
  const shardLabel = shards === 1 ? 'shard' : 'shards'
  const replicaLabel = replicas === 1 ? 'replica' : 'replicas'
  return `Distributed wrapper over local table ${local} on cluster ${dist.cluster} (${shards} ${shardLabel} × ${replicas} ${replicaLabel}). Apply schema changes on the local table, then keep this Distributed table in sync.`
}

export function parseMaterializedViewTarget(
  createQuery: string | null | undefined
): string | null {
  if (typeof createQuery !== 'string' || createQuery.trim() === '') return null

  const match = createQuery.match(
    /\bTO\s+((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w$]*))?)/i
  )
  if (!match) return null

  return match[1].replace(/`/g, '')
}

/**
 * ClickHouse returns "no value" datetimes as the epoch string
 * `1970-01-01 00:00:00`. Parsing that yields a non-zero ms value once the
 * local timezone offset is applied, so detect it by year, not by `getTime()`.
 */
export function isEpochZero(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value.trim().startsWith('1970-01-01')) return true
  }
  const date = toDate(value)
  return date !== null && date.getUTCFullYear() < 1971
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date =
    typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export interface FormattedTimestamp {
  /** Short relative text ("3h ago") or the fallback for missing values. */
  relative: string
  /** Full locale timestamp for a tooltip / sub-line, or null when missing. */
  absolute: string | null
}

/**
 * Format a ClickHouse datetime as relative + absolute. Missing values and
 * epoch-zero both render as `fallback` (default "never") — never as
 * `1/1/1970, 12:00:00 AM`.
 */
export function formatTimestamp(
  value: unknown,
  fallback = 'never'
): FormattedTimestamp {
  if (isEpochZero(value)) return { relative: fallback, absolute: null }

  const date = toDate(value)
  if (date === null) return { relative: fallback, absolute: null }

  return {
    relative: formatRelativeTime(date.getTime()),
    absolute: date.toLocaleString(),
  }
}
