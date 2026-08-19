/**
 * @chm/query-advisor-core — the shared ClickHouse query-advisor engine.
 *
 * Given a slow query, this package scores candidate ClickHouse-specific
 * optimizations (skip index, projection, partition key, PREWHERE rewrite) and
 * ranks them by estimated granules/bytes saved. It is the single source of
 * truth for two surfaces that used to carry byte-for-byte copies of the same
 * logic (issue #2936):
 *
 *  - `apps/dashboard/src/lib/ai/advisor/` (agent tool + `/api/v1/advisor`)
 *  - `packages/mcp-server/src/tools/advisor/` (`get_optimization_recommendations`)
 *
 * ABSOLUTE INVARIANT: this package RECOMMENDS ONLY. It does no I/O at all —
 * callers gather EXPLAIN/schema/parts data with their own read-only fetcher,
 * hand it over as a `QueryContext`, and get back inert data (strings +
 * numbers). No function here executes, applies, or mutates anything, and none
 * should ever be added — see `src/recommend-only.test.ts` for the enforcing
 * test.
 *
 * Layers:
 *  - `types.ts` — the shared vocabulary (`QueryContext`, `Recommendation`, …).
 *  - `sql-parsing.ts` — hand-rolled, best-effort SQL/EXPLAIN parsing.
 *  - `advisor-errors.ts` — shared no-table / missing-input classification.
 *  - `scorers.ts` — the pure scoring rules + ranking.
 *  - `impact.ts` — estimate math and the honest estimate summaries.
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
