/**
 * Query advisor MCP tool — analyzes a slow query and returns ranked,
 * recommend-only DDL/rewrite suggestions (skip-index, projection, partition
 * key, PREWHERE). See plans/46-query-advisor-engine.md.
 *
 * The parsing/scoring/impact/rewrite logic used to be a byte-for-byte copy of
 * the dashboard's advisor engine. It now lives in `@chm/query-advisor-core`
 * (issue #2936), which both surfaces import, so a scoring change lands in both
 * at once. Only the I/O layer differs (`runReadonlyFetch` here vs. the
 * dashboard's `readOnlyQuery`).
 *
 * ABSOLUTE INVARIANT: recommend-only. Nothing here executes, applies, or
 * mutates anything — every ClickHouse call goes through `runReadonlyFetch`
 * (which forces `clickhouse_settings.readonly = '1'`), and the returned
 * recommendations are inert DDL/rewrite text, never executed.
 *
 * File layout:
 * - `data-fetchers.ts` — the I/O layer (`runReadonlyFetch` calls).
 * - `index.ts` (this file) — orchestration: resolves/validates the SQL, builds
 *   the `QueryContext`, runs the shared scorers, ranks the results, and
 *   registers the MCP tool.
 */

import { z } from 'zod'

import type {
  PartsStats,
  Recommendation,
  TableSchema,
} from '@chm/query-advisor-core'
import type { McpServer } from '@modelcontextprotocol/server'

import {
  hostIdSchema,
  READONLY_ANNOTATIONS,
  toErrorResult,
  toJsonResult,
} from '../helpers'
import {
  fetchExplainIndexes,
  fetchPartsStats,
  fetchTableSchema,
  measurePrewhereImpact,
  resolveSql,
} from './data-fetchers'
import {
  buildPrewhereRecommendation,
  buildQueryContext,
  extractReferencedTables,
  proposePrewhereRewrite,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from '@chm/query-advisor-core'
import { validateSqlQuery } from '@chm/sql-builder'

interface AnalyzeQueryResult {
  ok: boolean
  sql?: string
  database?: string
  table?: string
  recommendations?: Recommendation[]
  notes?: string[]
  error?: string
}

async function analyzeQuery(params: {
  hostId: number
  sql?: string
  queryId?: string
  database?: string
}): Promise<AnalyzeQueryResult> {
  const { hostId, database = 'default' } = params
  const notes: string[] = []

  let sql: string | null
  try {
    sql = await resolveSql(hostId, params.sql, params.queryId)
  } catch (err) {
    return {
      ok: false,
      error: `Could not resolve query_id: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!sql) {
    return {
      ok: false,
      error: params.queryId
        ? `No finished query found in system.query_log for query_id "${params.queryId}".`
        : 'Provide either `sql` or `queryId`.',
    }
  }

  try {
    validateSqlQuery(sql)
  } catch (err) {
    return {
      ok: false,
      error: `Query failed validation: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const referencedTables = extractReferencedTables(sql, database)
  const target = referencedTables[0]
  if (!target) {
    return {
      ok: false,
      error:
        'Could not identify a target table in the query (no FROM/JOIN found).',
    }
  }
  if (referencedTables.length > 1) {
    notes.push(
      `Query references ${referencedTables.length} tables; only \`${target.qualifiedName}\` (the first) was analyzed.`
    )
  }

  let schema: TableSchema
  let parts: PartsStats
  try {
    ;[schema, parts] = await Promise.all([
      fetchTableSchema(hostId, target.database, target.table),
      fetchPartsStats(hostId, target.database, target.table),
    ])
  } catch (err) {
    return {
      ok: false,
      error: `Could not read schema/parts for ${target.qualifiedName}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const explain = await fetchExplainIndexes(hostId, sql)
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

  return {
    ok: true,
    sql,
    database: target.database,
    table: target.table,
    recommendations: rankRecommendations(recommendations),
    notes,
  }
}

export function registerAdvisorTool(server: McpServer) {
  server.registerTool(
    'get_optimization_recommendations',
    {
      title: 'Get Optimization Recommendations',
      description:
        'Analyze a slow query (by `queryId` from system.query_log, or raw `sql`) and return RANKED optimization recommendations — skip-index, projection, partition key, or a PREWHERE rewrite — each with DDL/rewrite text, rationale, risk, effort, and an estimated granules/bytes saved. Read-only and recommend-only: it never executes or applies any DDL or rewrite.',
      inputSchema: {
        sql: z
          .string()
          .optional()
          .describe('Raw SQL to analyze. Provide this or queryId.'),
        queryId: z
          .string()
          .optional()
          .describe(
            'A query_id from system.query_log to resolve and analyze. Provide this or sql.'
          ),
        database: z
          .string()
          .optional()
          .describe(
            'Default database for unqualified table references (default: "default").'
          ),
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ sql, queryId, database, hostId }) => {
      const result = await analyzeQuery({
        hostId: hostId ?? 0,
        sql,
        queryId,
        database,
      })
      if (!result.ok) return toErrorResult(result.error ?? 'Analysis failed.')
      return toJsonResult(result)
    }
  )
}
