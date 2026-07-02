/**
 * Insight generation orchestrator.
 *
 * Pipeline: collect (deterministic) → enrich (optional LLM) → persist (findings
 * store). Returns the generated insight cards. Best-effort throughout: a
 * read-only cluster or missing LLM key degrades gracefully rather than throwing,
 * so both the manual "Refresh" endpoint and the cron sweep can call it safely.
 */

import type { InsightPromptStyle } from './prompts'
import type { InsightCard } from './types'

import { collectInsights } from './collectors'
import { enrichInsights } from './llm-enrich'
import { readInsights } from './read-insights'
import { resolveInsightsStore } from './store/resolve-store'
import { insightKey } from './types'

const SOURCE = 'ai-insight'

/**
 * Minimum interval between full regenerations of a host's insights.
 *
 * The collect pipeline runs ~10 ClickHouse scans per call and is triggered both
 * per host/session (auto-generate on mount) and on every manual Refresh. Without
 * a floor, rapid reopens / repeated clicks re-run the whole pipeline needlessly.
 * When a host already has stored insights newer than this window, generation is
 * skipped and the stored set is returned instead. An explicit manual Refresh
 * (`force: true`) bypasses this floor for an immediate refresh.
 */
export const INSIGHTS_MIN_REGEN_INTERVAL_MS = 5 * 60 * 1000

/** Per-request generation overrides (from the settings UI / generate API). */
export interface GenerateInsightsOptions {
  /** `false` skips LLM enrichment entirely (deterministic copy only). */
  readonly enrich?: boolean
  /** Validated `provider:model` id used for enrichment. */
  readonly model?: string
  /** Enrichment tone. */
  readonly promptStyle?: InsightPromptStyle
  /**
   * Bypass the {@link INSIGHTS_MIN_REGEN_INTERVAL_MS} throttle and force a fresh
   * regeneration. Set by the explicit manual "Refresh" button so it always runs
   * immediately; left unset (throttled) for auto/cron-triggered generations.
   */
  readonly force?: boolean
}

/**
 * Most recent stored-insight timestamp for a host, in epoch ms, or `0` when the
 * store has no insights yet (or is unreadable). Best-effort — never throws.
 */
function newestInsightMs(cards: InsightCard[]): number {
  let newest = 0
  for (const c of cards) {
    const t = c.generatedAt ? Date.parse(c.generatedAt) : Number.NaN
    if (Number.isFinite(t) && t > newest) newest = t
  }
  return newest
}

/**
 * Generate, persist, and return AI insights for a host.
 * Never throws — returns an empty array on any unexpected failure.
 */
export async function generateInsights(
  hostId: number,
  opts: GenerateInsightsOptions = {}
): Promise<InsightCard[]> {
  try {
    // Server-side throttle: the collect pipeline is expensive (~10 ClickHouse
    // scans). When the store already holds insights newer than the min-interval
    // and this is not a forced refresh, skip regeneration and return the stored
    // set so per-session/auto triggers don't re-run the scans on every reopen.
    if (!opts.force) {
      const existing = await readInsights(hostId)
      const newest = newestInsightMs(existing)
      if (newest > 0 && Date.now() - newest < INSIGHTS_MIN_REGEN_INTERVAL_MS) {
        return existing
      }
    }

    const candidates = await collectInsights(hostId)
    if (candidates.length === 0) return []

    const enriched =
      opts.enrich === false
        ? candidates
        : await enrichInsights(candidates, {
            model: opts.model,
            promptStyle: opts.promptStyle,
          })
    const generatedAt = new Date().toISOString()

    // Persist the batch through the configured backend (ClickHouse by default;
    // D1 / Postgres / AgentState / Memory via INSIGHTS_STORE_BACKEND). The store
    // is best-effort — a read-only cluster or missing binding degrades silently.
    const store = await resolveInsightsStore()
    await store.record(
      hostId,
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
      key: insightKey(hostId, c),
      generatedAt,
    }))
  } catch {
    return []
  }
}
