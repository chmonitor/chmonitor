/**
 * Query advisor — shared types.
 *
 * Split out from `recommendation-engine.ts` so `impact-estimator.ts` and
 * `sql-rewriter.ts` can depend on these types without creating an import
 * cycle back through `recommendation-engine.ts` (which itself imports from
 * both of those files). `recommendation-engine.ts` re-exports everything
 * here, so existing `from './recommendation-engine'` imports are unaffected.
 */

export type RecommendationKind =
  | 'skip_index'
  | 'projection'
  | 'partition_key'
  | 'prewhere'

export type RiskLevel = 'low' | 'medium' | 'high'
export type EffortLevel = 'low' | 'medium' | 'high'

export interface EstimatedImpact {
  /** Estimated granules skippable, out of the granules currently read (upper bound, not guaranteed). */
  granulesSaved: number
  /** Total granules ClickHouse currently reads for this query (0 when unknown). */
  granulesRead: number
  /** Estimated bytes read saved, derived from column/table byte sizes. Always an estimate. */
  bytesSaved: number
  /** Human-readable estimate summary — always states it IS an estimate. */
  summary: string
  /** True when granule/byte figures could not be derived (EXPLAIN unavailable) — impact is 0 and unranked accordingly. */
  unknown: boolean
}

export interface Recommendation {
  kind: RecommendationKind
  title: string
  /** Why this candidate was suggested. */
  rationale: string
  /** DDL text to review and run manually. `null` for `prewhere` (a query rewrite, not DDL). */
  ddl: string | null
  /** Only set for `prewhere` — the rewritten SELECT for the user to review. Never executed. */
  rewrittenSql?: string
  risk: RiskLevel
  riskNote: string
  effort: EffortLevel
  estImpact: EstimatedImpact
}

/** A single top-level `WHERE`/`AND`-joined predicate this engine can reason about. */
export interface SqlPredicate {
  column: string
  operator: string
  isRange: boolean
  isEqualityOrIn: boolean
}

export interface ColumnStat {
  name: string
  type: string
  isInPartitionKey: boolean
  isInSortingKey: boolean
  compressedBytes: number
  uncompressedBytes: number
}

export interface ExistingSkipIndex {
  name: string
  type: string
  expression: string
  granularity: number
}

export interface TableSchema {
  database: string
  table: string
  partitionKeyColumns: string[]
  sortingKeyColumns: string[]
  columns: ColumnStat[]
  existingSkipIndexes: ExistingSkipIndex[]
}

export interface PartsStats {
  activeParts: number
  totalRows: number
  totalBytes: number
  /** `sum(marks)` across active parts — one mark per granule, so this is the table's total granule count. */
  totalGranules: number
}

export interface PrimaryKeyExplain {
  partsRead: number
  partsTotal: number
  granulesRead: number
  granulesTotal: number
}

export interface SkipIndexExplain {
  name: string
  description: string
  partsRead: number
  partsTotal: number
  granulesRead: number
  granulesTotal: number
}

export interface ExplainIndexesInfo {
  primaryKey: PrimaryKeyExplain | null
  skipIndexes: SkipIndexExplain[]
}

/** Everything the scorers need, already gathered/parsed read-only. */
export interface QueryContext {
  sql: string
  database: string
  table: string
  predicates: SqlPredicate[]
  groupByColumns: string[]
  orderByColumns: string[]
  hasPrewhere: boolean
  schema: TableSchema
  parts: PartsStats
  explain: ExplainIndexesInfo | null
}
