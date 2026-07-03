/**
 * Shared types for the AI insights engine.
 *
 * An *insight* is a short, actionable observation about a cluster — surfaced on
 * the overview page and persisted via the findings store (source `ai-insight`).
 * Insights are produced by deterministic collectors (always available) and
 * optionally polished by an LLM when a provider key is configured.
 */

import type { ForecastResult } from '@/lib/ai/advisor/capacity-forecaster'

export type InsightSeverity = 'info' | 'warning' | 'critical'

/** A single highlighted finding surfaced in a weekly report's "top findings" section. */
export interface WeeklyTopFinding {
  readonly severity: InsightSeverity
  readonly category: string
  readonly title: string
  readonly detail: string
  readonly metric: string
  readonly generatedAt: string
}

/** Weekly report capacity section: the real forecast, or a degraded-but-honest fallback. */
export type WeeklyReportCapacity =
  | ForecastResult
  | {
      readonly available: false
      readonly reason: 'error'
      readonly message: string
    }

/** Compact, JSON-serializable summary of a host's weekly report. */
export interface WeeklyReportSummary {
  readonly hostId: number
  readonly hostLabel: string
  /** Start of the rolling 7-day window, `YYYY-MM-DD`. */
  readonly weekStart: string
  /** End of the window (today), `YYYY-MM-DD`. */
  readonly weekEnd: string
  readonly generatedAt: string
  readonly totalFindings: number
  readonly bySeverity: Record<InsightSeverity, number>
  readonly byCategory: Record<string, number>
  readonly topFindings: readonly WeeklyTopFinding[]
  /** Count of metrics with a fitted statistical baseline (plan 48). */
  readonly baselinesFitted: number
  readonly capacity: WeeklyReportCapacity
}

/** A recommended next step the operator can take for an insight. */
export interface InsightAction {
  /** Button label, e.g. "View tables". */
  readonly label: string
  /** Internal route the action links to, e.g. "/tables". Optional. */
  readonly href?: string
  /**
   * Optional natural-language prompt to deep-link into the agent
   * (`/agents?q=...`) so the operator can dig deeper.
   */
  readonly prompt?: string
}

/** A candidate insight produced by a collector, before persistence. */
export interface InsightCandidate {
  readonly severity: InsightSeverity
  /** Coarse grouping: 'anomaly' | 'storage' | 'reliability' | 'performance'. */
  readonly category: string
  readonly title: string
  readonly detail: string
  /** Machine metric name (e.g. 'error_rate'); empty when narrative-only. */
  readonly metric?: string
  /** Numeric value backing the metric (stored as Float64). */
  readonly value?: number
  readonly action?: InsightAction
}

/** A persisted/served insight card. Adds a stable key for dismissal. */
export interface InsightCard extends InsightCandidate {
  /**
   * Stable identity across regenerations: `host:category:metric:title`.
   * Dismissals (localStorage) key off this so re-running generation does not
   * resurrect an insight the user already dismissed.
   */
  readonly key: string
  /** ISO timestamp the insight was recorded, when known. */
  readonly generatedAt?: string
}

/** Insight sources we treat as "AI insights" when reading the findings table. */
export const INSIGHT_SOURCES = ['ai-insight'] as const

/** Build the stable dismissal key for an insight. */
export function insightKey(
  hostId: number,
  candidate: Pick<InsightCandidate, 'category' | 'metric' | 'title'>
): string {
  return `${hostId}:${candidate.category}:${candidate.metric ?? ''}:${candidate.title}`
}
