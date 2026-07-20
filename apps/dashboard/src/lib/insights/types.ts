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

/** Report cadence: weekly (7-day window) or monthly (30-day window). */
export type ReportPeriod = 'weekly' | 'monthly'

/** One per-day point in a report time series (`date` = `YYYY-MM-DD`). */
export interface ReportSeriesPoint {
  readonly date: string
  readonly value: number
}

/**
 * Query-activity section data over the report window (system.query_log).
 * Daily series are capped at 31 points (one per day, monthly window max).
 */
export interface WeeklyReportQueryActivity {
  readonly totalQueries: number
  readonly failedQueries: number
  /** Median finished-query duration over the window, milliseconds. */
  readonly p50Ms: number
  /** 95th-percentile finished-query duration over the window, milliseconds. */
  readonly p95Ms: number
  readonly dailyQueries: readonly ReportSeriesPoint[]
  readonly dailyFailed: readonly ReportSeriesPoint[]
}

/** Ingestion section data: INSERT-written rows/bytes per day (system.query_log). */
export interface WeeklyReportIngestion {
  readonly totalRows: number
  readonly totalBytes: number
  readonly dailyRows: readonly ReportSeriesPoint[]
  readonly dailyBytes: readonly ReportSeriesPoint[]
}

/** One of the top-N tables by on-disk size (system.parts, active). */
export interface WeeklyReportTopTable {
  /** Fully qualified `database.table`. */
  readonly table: string
  readonly bytes: number
  readonly rows: number
  /**
   * Bytes in active parts (re)written within the report window
   * (`modification_time` in window). An approximation of recent growth —
   * merges rewrite parts, so this can overstate net new data.
   */
  readonly newBytes: number
}

/** Storage section data: cluster totals + top tables (system.parts, active). */
export interface WeeklyReportStorage {
  readonly totalBytes: number
  readonly totalRows: number
  readonly topTables: readonly WeeklyReportTopTable[]
}

/** Compact, JSON-serializable summary of a host's weekly report. */
export interface WeeklyReportSummary {
  readonly hostId: number
  readonly hostLabel: string
  /**
   * Report window cadence. Optional for backward compatibility with rows
   * persisted before monthly reports existed — absent means 'weekly'.
   */
  readonly period?: ReportPeriod
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
  /**
   * Optional data-rich sections (query activity, ingestion, storage). All are
   * OPTIONAL and fail-open: absent when the collector failed or the section
   * predates them (persisted summaries re-render from stored JSON, so old rows
   * must keep parsing). Renderers omit a section entirely when absent.
   */
  readonly queryActivity?: WeeklyReportQueryActivity
  readonly ingestion?: WeeklyReportIngestion
  readonly storage?: WeeklyReportStorage
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

/**
 * Engine an insight belongs to, threaded into {@link insightKey} so a Postgres
 * finding never collides with a ClickHouse one that happens to share a
 * category/metric/title. Absent = ClickHouse (the historical default) so every
 * existing key stays byte-identical.
 */
export type InsightEngine = 'clickhouse' | 'postgres'

/**
 * Reserved store-host offset that partitions Postgres insight findings away from
 * ClickHouse host ids inside the shared, numeric-`hostId`-keyed
 * {@link InsightsStore}.
 *
 * The store is keyed by a bare numeric `hostId`. ClickHouse env hosts are small
 * indices (`0,1,2,…`) and per-user D1 connections use NEGATIVE ids, so the huge
 * positive offset below is disjoint from both. Recording Postgres findings under
 * `hostId = OFFSET + pgHostId` lets the existing five backends (ClickHouse / D1 /
 * Postgres / AgentState / memory) persist Postgres insights UNCHANGED — no new
 * engine column, no table migration — while guaranteeing a Postgres source can
 * never be read back as ClickHouse host 0 (and vice-versa). All existing
 * ClickHouse keys stay byte-identical (zero migration).
 */
export const POSTGRES_INSIGHT_STORE_HOST_OFFSET = 1_000_000

/**
 * Map a `pgHostId` (index into the `POSTGRES_*` env lists) to the reserved
 * numeric host key the {@link InsightsStore} persists it under. See
 * {@link POSTGRES_INSIGHT_STORE_HOST_OFFSET}.
 */
export function pgInsightStoreHostId(pgHostId: number): number {
  return POSTGRES_INSIGHT_STORE_HOST_OFFSET + pgHostId
}

/**
 * Build the stable dismissal key for an insight.
 *
 * ClickHouse (default): `host:category:metric:title` — unchanged, so existing
 * dismissals keep working. Postgres: `pg:pgHostId:category:metric:title`, a
 * readable, engine-prefixed key that can never alias a ClickHouse key.
 */
export function insightKey(
  hostId: number,
  candidate: Pick<InsightCandidate, 'category' | 'metric' | 'title'>,
  engine: InsightEngine = 'clickhouse'
): string {
  const host = engine === 'postgres' ? `pg:${hostId}` : `${hostId}`
  return `${host}:${candidate.category}:${candidate.metric ?? ''}:${candidate.title}`
}
