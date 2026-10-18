/**
 * Query advisor — recommendation engine (orchestration layer).
 *
 * ABSOLUTE INVARIANT: this module RECOMMENDS ONLY. Nothing here executes,
 * applies, or mutates anything — every scorer only issues read-only queries
 * (`readOnlyQuery`, which forces `clickhouse_settings.readonly = '1'`) and
 * returns inert data. No function that runs a recommendation's DDL/rewrite
 * against ClickHouse should ever be added here; `analyze-query.test.ts`
 * enforces this.
 *
 * Pure parsing + scoring live in `@chm/query-advisor-core`, shared with the MCP
 * tool so both surfaces recommend the same thing for the same query. Every
 * `estImpact` is an ESTIMATE; see `impact-estimator.ts`.
 */

import type {
  ColumnStat,
  EffortLevel,
  EstimatedImpact,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  PrimaryKeyExplain,
  QueryContext,
  Recommendation,
  RecommendationKind,
  RiskLevel,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
} from './types'

import { measurePrewhereImpact } from './impact-estimator'
import {
  fetchExplainIndexes,
  fetchPartsStats,
  fetchTableSchema,
  fetchTableTopology,
  resolveSql,
} from './query-context'
import {
  type AdvisorErrorCode,
  buildPrewhereRecommendation,
  buildQueryContext,
  extractReferencedTables,
  findAdvisorTargetTable,
  proposePrewhereRewrite,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from '@chm/query-advisor-core'
import { validateSqlQuery } from '@chm/sql-builder'
import { annotateDdlForTopology } from '@/lib/ddl/on-cluster'

export type {
  ColumnStat,
  EffortLevel,
  EstimatedImpact,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  PrimaryKeyExplain,
  QueryContext,
  Recommendation,
  RecommendationKind,
  RiskLevel,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
}

export { estimateBytesSaved } from './impact-estimator'
export {
  extractClauseColumns,
  extractPredicates,
  type PrewhereRewrite,
  parseExplainIndexes,
  proposePrewhereRewrite,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from '@chm/query-advisor-core'

export interface AnalyzeQueryInput {
  hostId: number
  sql?: string
  queryId?: string
  database?: string
}

export interface AnalyzeQueryOk {
  ok: true
  /** Discriminator the chat UI's tool-output renderer keys off to show `AdvisorRecommendationsPanel`. */
  type: 'query_advisor_recommendations'
  sql: string
  database: string
  table: string
  recommendations: Array<
    Recommendation & {
      localTableName?: string | null
      onClusterStatement?: string | null
      localOnlyReason?: string | null
    }
  >
  notes: string[]
}

export interface AnalyzeQueryError {
  ok: false
  error: string
  code?: AdvisorErrorCode
}

export type AnalyzeQueryResult = AnalyzeQueryOk | AnalyzeQueryError

/** Read-only end to end; a missing table or failed EXPLAIN reduces what can be estimated rather than throwing. */
export async function analyzeQuery(
  input: AnalyzeQueryInput
): Promise<AnalyzeQueryResult> {
  const { hostId, database = 'default' } = input
  const notes: string[] = []

  let sql: string | null
  try {
    sql = await resolveSql(hostId, input.sql, input.queryId)
  } catch (err) {
    return {
      ok: false,
      code: 'query_not_found',
      error: `Could not resolve query_id: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!sql) {
    return {
      ok: false,
      code: input.queryId ? 'query_not_found' : 'missing_input',
      error: input.queryId
        ? `No finished query found in system.query_log for query_id "${input.queryId}". Paste the SQL, or pick a query from history.`
        : 'Provide either `sql` or `queryId`.',
    }
  }

  try {
    validateSqlQuery(sql)
  } catch (err) {
    return {
      ok: false,
      code: 'invalid_sql',
      error: `Query failed validation: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const targetResult = findAdvisorTargetTable(sql, database)
  if (!targetResult.ok) return targetResult
  const target = targetResult.table
  const referencedTables = extractReferencedTables(sql, database)
  if (referencedTables.length > 1) {
    notes.push(
      `Query references ${referencedTables.length} tables; only \`${target.qualifiedName}\` (the first) was analyzed.`
    )
  }

  let schema: TableSchema
  let parts: PartsStats
  const explainP = fetchExplainIndexes(hostId, sql)
  const topologyP = fetchTableTopology(hostId, target.database, target.table)
  try {
    ;[schema, parts] = await Promise.all([
      fetchTableSchema(hostId, target.database, target.table),
      fetchPartsStats(hostId, target.database, target.table),
    ])
  } catch (err) {
    return {
      ok: false,
      code: 'schema_unavailable',
      error: `Could not read schema/parts for ${target.qualifiedName}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const explain = await explainP
  if (!explain) {
    notes.push(
      'EXPLAIN failed or was not permitted — impact estimates fall back to table-wide totals and are less precise.'
    )
  }

  const ctx = buildQueryContext({
    sql,
    database: target.database,
    table: target.table,
    schema,
    parts,
    explain,
  })

  const projectionRecommendation = scoreProjection(ctx)
  const partitionKeyRecommendation = scorePartitionKey(ctx)
  const recommendations: Recommendation[] = [
    ...scoreSkipIndex(ctx),
    ...(projectionRecommendation ? [projectionRecommendation] : []),
    ...(partitionKeyRecommendation ? [partitionKeyRecommendation] : []),
  ]

  if (!ctx.hasPrewhere) {
    const prewhereCandidate = proposePrewhereRewrite(ctx)
    if (prewhereCandidate) {
      const impact = await measurePrewhereImpact({
        hostId,
        originalSql: sql,
        rewrittenSql: prewhereCandidate.rewrittenSql,
        fallbackGranulesRead:
          ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules,
        fallbackGranulesTotal:
          ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules,
        tableBytes: ctx.parts.totalBytes,
        movedColumn: prewhereCandidate.movedPredicate.column,
      })
      recommendations.push(
        buildPrewhereRecommendation(prewhereCandidate, impact)
      )
    }
  }

  const ranked = rankRecommendations(recommendations)
  let topology = null
  try {
    topology = await topologyP
  } catch {
    topology = null
  }

  const annotated = ranked.map((rec) => {
    if (!rec.ddl) {
      return {
        ...rec,
        localTableName:
          topology?.localDatabase && topology.localTable
            ? `${topology.localDatabase}.${topology.localTable}`
            : null,
        onClusterStatement: null,
        localOnlyReason: topology?.cluster
          ? 'This recommendation is a query rewrite, not table DDL — ON CLUSTER does not apply.'
          : null,
      }
    }
    const variant = annotateDdlForTopology(rec.ddl, topology)
    return {
      ...rec,
      ddl: variant.statement,
      localTableName: variant.localTableName,
      onClusterStatement: variant.onClusterStatement,
      localOnlyReason: variant.localOnlyReason,
    }
  })

  return {
    ok: true,
    type: 'query_advisor_recommendations',
    sql,
    database: target.database,
    table: target.table,
    recommendations: annotated,
    notes,
  }
}
