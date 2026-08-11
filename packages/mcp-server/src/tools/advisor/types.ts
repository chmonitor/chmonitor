/**
 * Shared types for the query advisor (see `../advisor.ts` header for the
 * duplication note this whole `advisor/` tree inherits).
 */

export type RecommendationKind =
  | 'skip_index'
  | 'projection'
  | 'partition_key'
  | 'prewhere'
export type RiskLevel = 'low' | 'medium' | 'high'
export type EffortLevel = 'low' | 'medium' | 'high'

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
  granulesSaved: number
  granulesRead: number
  bytesSaved: number
  summary: string
  unknown: boolean
}

export interface Recommendation {
  kind: RecommendationKind
  title: string
  rationale: string
  ddl: string | null
  rewrittenSql?: string
  risk: RiskLevel
  riskNote: string
  effort: EffortLevel
  estImpact: EstimatedImpact
}

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
