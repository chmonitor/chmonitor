/**
 * MV / projection designer tool.
 *
 * Wraps `lib/ai/advisor/mv-designer.ts` — mines frequent aggregation shapes
 * from `system.query_log` and returns ranked MV/projection DDL
 * recommendations with a size estimate, impact, and risk. Recommend-only:
 * copy-DDL, never applied. See plans/47-mv-projection-designer.md.
 *
 * `designMaterializedViews` is imported dynamically inside `execute()`
 * (rather than statically at module scope) to keep merely constructing the
 * tool registry (`createAllTools`) free of side effects — mirrors the same
 * pattern used for the capacity-forecast tools in `storage-tools.ts` and the
 * anomaly-baseline tool in `insight-tools.ts`.
 */

import { z } from 'zod'

import { hostIdSchema, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

export function createMvDesignerTools(hostId: number) {
  return {
    recommend_materialized_view: dynamicTool({
      description:
        'Mine frequent aggregation queries (GROUP BY + aggregate functions) from system.query_log and design a materialized view (Summing/AggregatingMergeTree) or projection to pre-aggregate them, with a size estimate, estimated read-bytes-saved impact, and an explicit risk note (added write-path/storage cost). Recommend-only — returns DDL text to review and copy; nothing is ever executed or applied.',
      inputSchema: z.object({
        table: z
          .string()
          .optional()
          .describe(
            "Restrict analysis to one table ('database.table' or just 'table'). Omit to analyze the top aggregation shapes across all tables."
          ),
        windowHours: z
          .number()
          .int()
          .positive()
          .optional()
          .default(24 * 7)
          .describe(
            'How many hours of system.query_log history to mine (default 168 = 7 days).'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { designMaterializedViews } = await import(
          '@/lib/ai/advisor/mv-designer'
        )
        const {
          table,
          windowHours,
          hostId: toolHostId,
        } = input as {
          table?: string
          windowHours?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        return designMaterializedViews({
          hostId: resolvedHostId,
          table,
          windowHours,
        })
      },
    }),
  }
}
