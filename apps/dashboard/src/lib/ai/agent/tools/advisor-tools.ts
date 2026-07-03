/**
 * Query advisor tool — surfaces `analyzeQuery` (see
 * `@/lib/ai/advisor/recommendation-engine`) to the AI agent.
 *
 * `recommendation-engine.ts` is imported dynamically inside `execute` (not
 * statically at module scope), mirroring `storage-tools.ts`'s
 * `forecast_disk_capacity`/`suggest_ttl_adjustment` — keeps constructing the
 * tool registry (`createAllTools`) cheap and side-effect-free regardless of
 * what the advisor module pulls in.
 *
 * Recommend-only: this tool returns ranked DDL/rewrite text, risk, effort,
 * and an estimated impact. It never executes or applies anything — see
 * plans/46-query-advisor-engine.md.
 */

import { z } from 'zod'

import { hostIdSchema, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

export function createAdvisorTools(hostId: number) {
  return {
    get_optimization_recommendations: dynamicTool({
      description:
        'Analyze a slow query (by `queryId` from system.query_log, or raw `sql`) and return RANKED optimization recommendations — skip-index, projection, partition key, or a PREWHERE rewrite — each with DDL/rewrite text, rationale, risk, effort, and an estimated granules/bytes saved. Read-only and recommend-only: it never executes or applies any DDL or rewrite. Always present the DDL/rewrite text for the user to review and run themselves.',
      inputSchema: z.object({
        sql: z
          .string()
          .optional()
          .describe('Raw SQL to analyze. Provide this or `queryId`.'),
        queryId: z
          .string()
          .optional()
          .describe(
            'A `query_id` from system.query_log to resolve and analyze. Provide this or `sql`.'
          ),
        database: z
          .string()
          .optional()
          .describe(
            'Default database for unqualified table references in the query (default: "default").'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { analyzeQuery } = await import(
          '@/lib/ai/advisor/recommendation-engine'
        )
        const {
          sql,
          queryId,
          database,
          hostId: toolHostId,
        } = input as {
          sql?: string
          queryId?: string
          database?: string
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        return analyzeQuery({
          hostId: resolvedHostId,
          sql,
          queryId,
          database,
        })
      },
    }),
  }
}
