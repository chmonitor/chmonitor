/**
 * @chm/query-advisor-core: the ClickHouse query-advisor engine shared by
 * `apps/dashboard/src/lib/ai/advisor/` and `packages/mcp-server/src/tools/advisor/`.
 * Scores skip-index, projection, partition-key and PREWHERE candidates and ranks
 * them by estimated granules/bytes saved.
 *
 * ABSOLUTE INVARIANT: RECOMMENDS ONLY. No I/O; callers gather EXPLAIN/schema/parts
 * data with their own read-only fetcher and get back inert strings and numbers.
 */

export {
  ADVISOR_ERROR_CODES,
  ADVISOR_NO_TARGET_TABLE_MESSAGE,
  type AdvisorErrorCode,
  type AdvisorInputError,
  type AdvisorTargetTableOk,
  type AdvisorTargetTableResult,
  advisorNoTargetTableError,
  findAdvisorTargetTable,
  isAdvisorUserInputError,
} from './advisor-errors'
export {
  estimateBytesSaved,
  formatBytes,
  type PrewhereFallbackInput,
  type PrewhereMarksInput,
  prewhereFallbackImpact,
  type SummarizeImpactInput,
  sumEstimateMarks,
  summarizeImpact,
  summarizePrewhereMarks,
} from './impact'
export {
  buildPrewhereRecommendation,
  pickPrewhereCandidate,
  proposePrewhereRewrite,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from './scorers'
export {
  type BuildQueryContextInput,
  buildQueryContext,
  extractClauseColumns,
  extractPredicates,
  extractReferencedTables,
  findWhereSpan,
  formatQualifiedTable,
  normalizeIdentifier,
  parseExplainIndexes,
  quoteIdentifier,
  splitTopLevelAnd,
  stripQuotedIdentifier,
} from './sql-parsing'
export {
  type ColumnStat,
  EFFORT_ORDER,
  type EffortLevel,
  type EstimatedImpact,
  type ExistingSkipIndex,
  type ExplainIndexesInfo,
  type PartsStats,
  type PrewhereRewrite,
  type PrimaryKeyExplain,
  type QueryContext,
  type Recommendation,
  type RecommendationKind,
  type ReferencedTable,
  RISK_ORDER,
  type RiskLevel,
  type SkipIndexExplain,
  type SqlPredicate,
  type TableSchema,
} from './types'
