/**
 * Cluster report generation tool (#2792).
 *
 * Lets the agent generate the same deterministic health report the scheduled
 * pipeline produces (insights + baselines + capacity forecast over a 7- or
 * 30-day window) and then narrate it — the agent-driven "narrative tier" is
 * the agent reading this structured output and writing its own executive
 * summary, not a separate LLM pipeline. Returns the summary + markdown (never
 * the HTML — token-heavy and useless to a model). Read-only; delivery and
 * scheduling stay with /report-settings and the cron.
 *
 * `buildWeeklyReport` is imported dynamically inside `execute` so that
 * constructing the registry never pulls in `@chm/platform` (see
 * insight-tools.ts for the rationale).
 */

import { z } from 'zod'

import { hostIdSchema, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

export function createReportTools(hostId: number) {
  return {
    generate_cluster_report: dynamicTool({
      description:
        'Generate a cluster health report (top insight findings, severity/category breakdown, statistical baselines count, disk-capacity outlook) over a weekly (7-day) or monthly (30-day) window. Returns structured summary + markdown for you to narrate or answer questions from. Read-only.',
      inputSchema: z.object({
        period: z
          .enum(['weekly', 'monthly'])
          .default('weekly')
          .describe('Report window: weekly = 7 days, monthly = 30 days.'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { period, hostId: inputHostId } = input as {
          period?: 'weekly' | 'monthly'
          hostId?: number
        }
        const resolvedHostId = resolveHostId(inputHostId, hostId)
        const { buildWeeklyReport } = await import(
          '@/lib/insights/weekly-report'
        )
        const report = await buildWeeklyReport(
          resolvedHostId,
          `Host ${resolvedHostId}`,
          period ?? 'weekly'
        )
        return { summary: report.summary, markdown: report.markdown }
      },
    }),
  }
}
