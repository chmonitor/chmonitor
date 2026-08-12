/**
 * Query advisor — shared types.
 *
 * The definitions live in `@chm/query-advisor-core`, the package this app
 * shares with the MCP advisor tool so the two surfaces speak the same
 * vocabulary (issue #2936). This module keeps the app-local
 * `@/lib/ai/advisor/types` import path — used by `lib/insights/`, the chat
 * panel, and every file in this directory — pointing at it, so the app has one
 * place to look for the advisor's shared shapes.
 */

export type {
  ColumnStat,
  EffortLevel,
  EstimatedImpact,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  PrewhereRewrite,
  PrimaryKeyExplain,
  QueryContext,
  Recommendation,
  RecommendationKind,
  RiskLevel,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
} from '@chm/query-advisor-core'
