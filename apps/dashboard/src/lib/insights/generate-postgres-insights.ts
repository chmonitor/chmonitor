/**
 * Postgres insight generation orchestrator.
 *
 * The Postgres analog of `generate-insights.ts`. Pipeline: collect
 * (deterministic Postgres reads) → enrich (optional LLM, shared with ClickHouse)
 * → persist (shared `InsightsStore`, partitioned under the reserved
 * `pgInsightStoreHostId` host key). Returns the generated cards, keyed with the
 * engine-prefixed `insightKey(pgHostId, …, 'postgres')`. Best-effort throughout:
 * an unreachable source or missing LLM key degrades gracefully rather than
 * throwing, so both the manual endpoint and the cron sweep can call it safely.
 */

import type { GenerateInsightsOptions } from './generate-insights'
import type { InsightCard } from './types'

import { INSIGHTS_MIN_REGEN_INTERVAL_MS } from './generate-insights'
import { enrichInsights } from './llm-enrich'
import { collectPostgresInsights } from './postgres-collectors'
import { readPostgresInsights } from './read-postgres-insights'
import { resolveInsightsStore } from './store/resolve-store'
import { insightKey, pgInsightStoreHostId } from './types'

const SOURCE = 'ai-insight'

/** Newest stored-insight timestamp (epoch ms), or 0 when none/unreadable. */
function newestInsightMs(cards: InsightCard[]): number {
  let newest = 0
  for (const c of cards) {
    const t = c.generatedAt ? Date.parse(c.generatedAt) : Number.NaN
    if (Number.isFinite(t) && t > newest) newest = t
  }
  return newest
}

/**
 * Generate, persist, and return AI insights for one env-configured Postgres
 * source (`pgHostId`). Never throws — returns `[]` on any unexpected failure.
 */
export async function generatePostgresInsights(
  pgHostId: number,
  opts: GenerateInsightsOptions = {}
): Promise<InsightCard[]> {
  try {
    // Server-side throttle, mirroring generateInsights: skip regeneration when
    // the store already holds Postgres insights newer than the min interval and
    // this is not a forced refresh.
    if (!opts.force) {
      const existing = await readPostgresInsights(pgHostId)
      const newest = newestInsightMs(existing)
      if (newest > 0 && Date.now() - newest < INSIGHTS_MIN_REGEN_INTERVAL_MS) {
        return existing
      }
    }

    const candidates = await collectPostgresInsights(pgHostId)
    if (candidates.length === 0) return []

    const enriched =
      opts.enrich === false
        ? candidates
        : await enrichInsights(candidates, {
            model: opts.model,
            promptStyle: opts.promptStyle,
          })
    const generatedAt = new Date().toISOString()

    // Persist through the configured backend under the reserved Postgres host
    // partition so ClickHouse reads can never see these rows. Best-effort.
    const store = await resolveInsightsStore()
    await store.record(
      pgInsightStoreHostId(pgHostId),
      enriched.map((c) => ({
        severity: c.severity,
        category: c.category,
        source: SOURCE,
        title: c.title,
        detail: c.detail,
        metric: c.metric,
        value: c.value,
      }))
    )

    return enriched.map((c) => ({
      ...c,
      key: insightKey(pgHostId, c, 'postgres'),
      generatedAt,
    }))
  } catch {
    return []
  }
}
