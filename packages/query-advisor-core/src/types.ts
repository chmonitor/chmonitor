/**
 * Query advisor — shared types and ordering constants.
 *
 * These are the vocabulary both advisor surfaces speak: the dashboard engine
 * (`apps/dashboard/src/lib/ai/advisor/`) and the MCP tool
 * (`packages/mcp-server/src/tools/advisor/`). Keeping them here is what stops
 * the two from drifting apart (issue #2936).
 */

export type RecommendationKind =
  | 'skip_index'
  | 'projection'
  | 'partition_key'
  | 'prewhere'

export type RiskLevel = 'low' | 'medium' | 'high'
export type EffortLevel = 'low' | 'medium' | 'high'

/** Numeric ordering used to break ties when granules-saved estimates match. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}
export const EFFORT_ORDER: Record<EffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

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

/** A `FROM`/`JOIN` table reference found in a query. */
export interface ReferencedTable {
  raw: string
  database: string
  table: string
  qualifiedName: string
}

/** A proposed PREWHERE rewrite — inert text for the user to review, never executed. */
export interface PrewhereRewrite {
  rewrittenSql: string
  movedPredicate: SqlPredicate
}
