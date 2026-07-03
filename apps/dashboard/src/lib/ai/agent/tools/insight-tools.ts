/**
 * Statistical anomaly baseline explanation tool.
 *
 * Surfaces the same per-host/per-metric baseline that `insights/collectors.ts`
 * scores against (see `lib/insights/statistical-baseline.ts`), so the agent can
 * explain *why* something is/isn't flagged as anomalous. Read-only — this tool
 * never fits, refits, or persists anything; it only reads whatever baseline is
 * already on file.
 *
 * `getBaseline`/`scoreAnomaly` are imported dynamically inside `execute`
 * (rather than statically at module scope) so that merely constructing the
 * tool registry (`createAllTools`) never pulls in `baseline-store.ts` ->
 * `@chm/platform` — apps/dashboard aliases that specifier to a
 * Cloudflare-Workers-only shim, which would otherwise break any test that
 * inspects `createAllTools()` without mocking it. Mirrors the same
 * dynamic-import-per-backend pattern already used in
 * `insights/store/resolve-store.ts`.
 */

import { z } from 'zod'

import { hostIdSchema, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

const round = (n: number) => Math.round(n * 100) / 100

export function createInsightTools(hostId: number) {
  return {
    explain_anomaly_score: dynamicTool({
      description:
        "Explain a per-host/per-metric statistical anomaly baseline (fitted mean/stddev/median/MAD over ~7 days). Given a current value, also returns its z-score and whether it's flagged as anomalous (|z| > 2). Read-only — never fits, refits, or applies anything; reports when no baseline has been fitted yet (cold start).",
      inputSchema: z.object({
        metric: z
          .string()
          .describe(
            "Metric name to explain, e.g. 'error_rate', 'query_duration_p95', 'memory_usage'."
          ),
        value: z
          .number()
          .optional()
          .describe(
            'Current metric value to score against the baseline. Omit to just inspect the baseline itself.'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { getBaseline } = await import('@/lib/insights/baseline-store')
        const { scoreAnomaly } = await import(
          '@/lib/insights/statistical-baseline'
        )
        const {
          metric,
          value,
          hostId: toolHostId,
        } = input as {
          metric: string
          value?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const baseline = await getBaseline(String(resolvedHostId), metric)

        if (!baseline) {
          return {
            hostId: resolvedHostId,
            metric,
            hasBaseline: false,
            explanation: `No statistical baseline has been fitted yet for "${metric}" on host ${resolvedHostId} — detection is using the static fallback threshold until enough history accumulates (baselines refit automatically as insights are generated).`,
          }
        }

        const stats = {
          mean: round(baseline.mean),
          stddev: round(baseline.stddev),
          median: round(baseline.median),
          mad: round(baseline.mad),
          sampleCount: baseline.sampleCount,
          fittedAt: new Date(baseline.fittedAt).toISOString(),
        }

        if (value === undefined) {
          return {
            hostId: resolvedHostId,
            metric,
            hasBaseline: true,
            ...stats,
            explanation: `Baseline for "${metric}" on host ${resolvedHostId}: mean ${stats.mean}, stddev ${stats.stddev} (median ${stats.median}, MAD ${stats.mad}), fitted from ${stats.sampleCount} samples at ${stats.fittedAt}. Pass a value to compute its anomaly score.`,
          }
        }

        const score = scoreAnomaly(value, baseline)
        const z = round(score.z)
        const direction = score.z >= 0 ? 'above' : 'below'

        return {
          hostId: resolvedHostId,
          metric,
          hasBaseline: true,
          ...stats,
          value,
          z,
          isAnomaly: score.isAnomaly,
          confidence: score.confidence,
          explanation: score.isAnomaly
            ? `${value} is ${round(Math.abs(score.z))} standard deviations ${direction} the "${metric}" baseline mean (${stats.mean} ± ${stats.stddev}, n=${stats.sampleCount}) — flagged as anomalous (confidence: ${score.confidence}).`
            : `${value} is within the normal range for "${metric}" (z=${z} against baseline mean ${stats.mean} ± ${stats.stddev}); not anomalous.`,
        }
      },
    }),
  }
}
