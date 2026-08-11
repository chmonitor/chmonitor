/**
 * Query advisor MCP tool — analyzes a slow query and returns ranked,
 * recommend-only DDL/rewrite suggestions (skip-index, projection, partition
 * key, PREWHERE). See plans/46-query-advisor-engine.md.
 *
 * DUPLICATION NOTE: the pure parsing/scoring/impact/rewrite logic in this
 * `advisor/` tree is a byte-for-byte copy of
 * `apps/dashboard/src/lib/ai/advisor/{recommendation-engine,impact-estimator,sql-rewriter}.ts`.
 * `packages/*` may not import from `apps/*` (depcruise `no-packages-to-apps`
 * — see `.dependency-cruiser.cjs`), so this MCP surface cannot reuse the
 * dashboard app's engine directly. If you change the scoring/DDL logic in
 * the dashboard version, copy the same change here so the two surfaces never
 * disagree on what they recommend for the same query. Only the I/O layer
 * differs (`runReadonlyFetch` here vs. the dashboard's `readOnlyQuery`).
 *
 * ABSOLUTE INVARIANT: recommend-only. Nothing here executes, applies, or
 * mutates anything — every ClickHouse call goes through `runReadonlyFetch`
 * (which forces `clickhouse_settings.readonly = '1'`), and the returned
 * recommendations are inert DDL/rewrite text, never executed.
 *
 * File layout:
 * - `sql-parse.ts` — the hand-rolled SQL parser (pure functions).
 * - `impact.ts` — impact estimation/presentation (pure functions).
 * - `rules/*.ts` — one scoring rule per file (skip-index, projection,
 *   partition-key, prewhere).
 * - `data-fetchers.ts` — the I/O layer (`runReadonlyFetch` calls).
 * - `index.ts` (this file) — orchestration: builds the `QueryContext`, runs
 *   the rules, ranks the results, and registers the MCP tool.
 */

import { z } from 'zod'

import type { McpServer } from '@modelcontextprotocol/server'
import type {
  PartsStats,
  QueryContext,
  Recommendation,
  TableSchema,
} from './types'

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
import { scorePartitionKey } from './rules/partition-key'
import { proposePrewhereRewrite } from './rules/prewhere'
import { scoreProjection } from './rules/projection'
import { scoreSkipIndex } from './rules/skip-index'
import {
  extractClauseColumns,
  extractPredicates,
  extractReferencedTables,
} from './sql-parse'
import { EFFORT_ORDER, RISK_ORDER } from './types'

function rankRecommendations(
  recommendations: Recommendation[]
): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    if (b.estImpact.granulesSaved !== a.estImpact.granulesSaved) {
      return b.estImpact.granulesSaved - a.estImpact.granulesSaved
    }
    if (RISK_ORDER[a.risk] !== RISK_ORDER[b.risk]) {
      return RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
    }
    return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]
  })
}

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

  const ctx: QueryContext = {
    sql,
    database: target.database,
    table: target.table,
    predicates: extractPredicates(sql),
    groupByColumns: extractClauseColumns(sql, 'GROUP BY'),
    orderByColumns: extractClauseColumns(sql, 'ORDER BY'),
    hasPrewhere: /\bPREWHERE\b/i.test(sql),
    schema,
    parts,
    explain,
  }

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
      const impact = await measurePrewhereImpact(
        hostId,
        sql,
        prewhereCandidate.rewrittenSql,
        ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules,
        ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules,
        ctx.parts.totalBytes,
        prewhereCandidate.movedPredicate.column
      )
      recommendations.push({
        kind: 'prewhere',
        title: `Move \`${prewhereCandidate.movedPredicate.column}\` into PREWHERE`,
        rationale: `\`${prewhereCandidate.movedPredicate.column}\` is a selective WHERE condition; evaluating it in PREWHERE filters rows before ClickHouse reads the remaining (wider) columns.`,
        ddl: null,
        rewrittenSql: prewhereCandidate.rewrittenSql,
        risk: 'low',
        riskNote:
          'PREWHERE does not change query semantics for a normal single-table SELECT. Double-check results still match if the query uses FINAL, replicated deduplication, or non-deterministic functions in the moved condition.',
        effort: 'low',
        estImpact: impact,
      })
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
