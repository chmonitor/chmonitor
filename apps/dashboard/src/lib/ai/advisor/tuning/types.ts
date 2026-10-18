/**
 * Advisor tuning engine: shared types. Schema-scoped companion to the
 * query-scoped `recommendation-engine.ts`.
 *
 * ABSOLUTE INVARIANT: recommend-only. Nothing under `tuning/` executes or
 * mutates anything; the engine issues read-only metadata queries and every
 * finding's `ddl` is inert text for the user to run. Rule functions are pure.
 */

export type TuningCategory = 'schema' | 'settings'

export type TuningRuleId =
  | 'nullable_column'
  | 'oversized_integer'
  | 'compression_codec'
  | 'low_cardinality'
  | 'missing_ttl'
  | 'too_many_partitions'
  | 'high_partition_count'
  | 'non_replicated_on_cluster'
  | 'missing_distributed'
  | 'uuid_leading_sort_key'
  | 'setting_tuning'

export type TuningSeverity = 'high' | 'medium' | 'low'

/**
 * One column, aggregated across active parts. `compressedBytes` /
 * `uncompressedBytes` come straight from `system.columns` (already summed over
 * parts); `rows` is the table's active row count (same for every column of a
 * table), used to project per-row width savings.
 */
export interface ColumnProfile {
  database: string
  table: string
  name: string
  /** Full ClickHouse type string, e.g. `Nullable(String)`, `UInt64`, `LowCardinality(String)`. */
  type: string
  /** `compression_codec` from system.columns — empty string means table/server default (LZ4). */
  compressionCodec: string
  compressedBytes: number
  uncompressedBytes: number
  /** Active rows in the owning table (0 when unknown). */
  rows: number
}

/**
 * One MergeTree-family (or Distributed) table for table-level advisor rules.
 * Partition/TTL/engine findings need this; column lint uses `ColumnProfile`.
 */
export interface TableProfile {
  database: string
  table: string
  engine: string
  engineFull: string
  sortingKey: string
  partitionKey: string
  primaryKey: string
  ttlExpression: string
  partitions: number
  activeParts: number
  bytesOnDisk: number
  rows: number
  /** Type of the first ORDER BY identifier, when that identifier is a real column. */
  leadingSortType: string
}

/** Cluster topology for recommend-only DDL; `null` when `system.clusters` is empty or unreadable (single-node). */
export type ClusterContext = {
  cluster: string
  replicaCount: number
  /** `db.table` keys that a Distributed engine already points at. */
  distributedTargets: Set<string>
  /** `db.table` keys that already exist in the scanned database. */
  existingTables: Set<string>
} | null

/**
 * One setting row from `system.settings` or `system.merge_tree_settings`,
 * normalized. `changed` reflects whether the value differs from the built-in
 * default.
 */
export interface SettingRow {
  name: string
  value: string
  changed: boolean
  /** Built-in default value (`default` column). Empty when unknown. */
  default: string
  source: 'settings' | 'merge_tree_settings'
}

export interface TuningFinding {
  ruleId: TuningRuleId
  category: TuningCategory
  title: string
  target: string
  rationale: string
  /** Concrete measured facts backing the finding (bytes, rows, ratios). */
  evidence: string
  /** Honest, explicitly-labelled-as-estimate benefit text. */
  estimatedBenefit: string
  /**
   * Byte figure used for ranking schema findings (bigger = higher). An
   * ESTIMATE — an upper bound projected from column widths, never a measured
   * result. 0 for settings findings (ranked by severity instead).
   */
  estimatedBytesSaved: number
  severity: TuningSeverity
  /** Ready-to-review statement. NEVER executed — the user runs it themselves. */
  ddl: string
  localTableName?: string | null
  onClusterStatement?: string | null
  localOnlyReason?: string | null
  /**
   * Optional read-only query to confirm the finding before applying its DDL
   * (e.g. count NULLs, observe an integer's real range, measure distinct
   * ratio). Present when the rule's trigger is a heuristic over metadata that
   * a cheap data probe would confirm.
   */
  verifyQuery?: string
  risk: TuningSeverity
  riskNote: string
}

export interface TuningReportOk {
  ok: true
  type: 'schema_tuning_findings'
  database: string
  /** Present when a single table was scanned; omitted for a whole-database scan. */
  table?: string
  findings: TuningFinding[]
  notes: string[]
}

export interface TuningReportError {
  ok: false
  error: string
}

export type TuningReport = TuningReportOk | TuningReportError
