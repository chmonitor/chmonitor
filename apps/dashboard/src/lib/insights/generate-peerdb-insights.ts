/**
 * PeerDB insight generation orchestrator.
 *
 * The PeerDB analog of `generate-postgres-insights.ts`. Pipeline: collect
 * (deterministic PeerDB reads via the dedicated collector path) → enrich
 * (optional LLM, shared with ClickHouse/Postgres) → persist (shared
 * `InsightsStore`, partitioned under the reserved `peerdbInsightStoreHostId`
 * host key). Returns the generated cards, keyed with the engine-prefixed
 * `insightKey(sourceId, …, 'peerdb')`. Best-effort throughout: unconfigured or
 * unreachable PeerDB degrades to `[]` rather than throwing, so both the manual
 * endpoint and the cron sweep can call it safely — and a PeerDB failure can
 * never break the ClickHouse sweep around it.
 */

import type { GenerateInsightsOptions } from './generate-insights'
import type { InsightCard } from './types'

import { INSIGHTS_MIN_REGEN_INTERVAL_MS } from './generate-insights'
import { enrichInsights } from './llm-enrich'
import {
  collectPeerDBInsights,
  type PeerDBSnapshotReader,
} from './peerdb-collectors'
import { PEERDB_SOURCE_ID, readPeerDBInsights } from './read-peerdb-insights'
import { resolveInsightsStore } from './store/resolve-store'
import { insightKey, peerdbInsightStoreHostId } from './types'

const SOURCE = 'ai-insight'

export { PEERDB_SOURCE_ID }

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
 * Generate, persist, and return AI insights for the env-configured PeerDB
 * deployment. Never throws — returns `[]` on any unexpected failure.
 */
export async function generatePeerDBInsights(
  opts: GenerateInsightsOptions & { reader?: PeerDBSnapshotReader } = {}
): Promise<InsightCard[]> {
  try {
    // Server-side throttle, mirroring generateInsights/generatePostgresInsights:
    // skip regeneration when the store already holds PeerDB insights newer than
    // the min interval and this is not a forced refresh.
    if (!opts.force) {
      const existing = await readPeerDBInsights()
      const newest = newestInsightMs(existing)
      if (newest > 0 && Date.now() - newest < INSIGHTS_MIN_REGEN_INTERVAL_MS) {
        return existing
      }
    }

    const candidates = await collectPeerDBInsights(opts.reader)
    if (candidates.length === 0) return []

    const enriched =
      opts.enrich === false
        ? candidates
        : await enrichInsights(candidates, {
            model: opts.model,
            promptStyle: opts.promptStyle,
          })
    const generatedAt = new Date().toISOString()

    // Persist through the configured backend under the reserved PeerDB host
    // partition so ClickHouse/Postgres reads can never see these rows.
    // Best-effort.
    const store = await resolveInsightsStore()
    await store.record(
      peerdbInsightStoreHostId(PEERDB_SOURCE_ID),
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
      key: insightKey(PEERDB_SOURCE_ID, c, 'peerdb'),
      generatedAt,
    }))
  } catch {
    return []
  }
}
