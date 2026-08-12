/**
 * Metric definitions for the GitHub-style "Activity Calendar" contribution
 * heatmap: the per-day payload shape, per-metric config (value getter,
 * formatting, colour ramp), and the intensity-tier mapping.
 */

import { formatCompactNumber, formatReadableSize } from '@/lib/format-readable'

/** One row of the per-day heatmap payload (all metrics for a single day). */
export interface HeatmapDayRow {
  date: string // 'YYYY-MM-DD'
  query_count: number
  failed_count: number
  memory_peak: number // bytes
  avg_duration_ms: number // milliseconds
  written_bytes: number // bytes
}

/** Backwards-compatible alias used by older imports. */
export type DayCell = HeatmapDayRow

/** Identifier for a heatmap metric / display mode. */
export type MetricKey = 'queries' | 'failed' | 'memory' | 'duration' | 'written'

/**
 * How a metric aggregates across days:
 * - `sum`: a daily volume that adds up (queries, failures, bytes written).
 * - `gauge`: a daily reading that does not sum (peak memory, avg duration).
 */
export type MetricAggregation = 'sum' | 'gauge'

export interface MetricConfig {
  key: MetricKey
  /** Pill + heading label, e.g. "Query Count". */
  label: string
  /** Aggregation behaviour, drives which KPI cards are shown. */
  aggregation: MetricAggregation
  /** Pull this metric's numeric value out of a day row. */
  getValue: (row: HeatmapDayRow) => number
  /** Format a value for KPIs / tooltips, e.g. 13247 → "13.2K". */
  format: (value: number) => string
  /**
   * Tailwind background classes, low → high. Tier 0 is the empty/no-activity
   * cell. Six entries: one empty tier + five intensity tiers. Class strings are
   * written out in full so Tailwind's JIT can see (and emit) them.
   */
  tiers: readonly [string, string, string, string, string, string]
  /** Accent text class for the highlighted ("peak") KPI value + legend. */
  accentText: string
  /** Accent background class for the active-mode dot / legend swatch. */
  accentDot: string
}

/** Format milliseconds as a compact human duration ("420ms", "1.8s", "18s"). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`
}

/**
 * Metric definitions, in display order. Each entry is fully self-describing so
 * the component stays a thin renderer over the chosen config.
 */
export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  queries: {
    key: 'queries',
    label: 'Query Count',
    aggregation: 'sum',
    getValue: (r) => r.query_count ?? 0,
    format: formatCompactNumber,
    // Keeps the existing chart-2 accent so the default mode matches the other
    // query charts across the dashboard.
    tiers: [
      'bg-muted/50',
      'bg-chart-2/20',
      'bg-chart-2/40',
      'bg-chart-2/60',
      'bg-chart-2/80',
      'bg-chart-2',
    ],
    accentText: 'text-chart-2',
    accentDot: 'bg-chart-2',
  },
  failed: {
    key: 'failed',
    label: 'Failed Queries',
    aggregation: 'sum',
    getValue: (r) => r.failed_count ?? 0,
    format: formatCompactNumber,
    tiers: [
      'bg-muted/50',
      'bg-rose-500/20',
      'bg-rose-500/40',
      'bg-rose-500/60',
      'bg-rose-500/80',
      'bg-rose-500',
    ],
    accentText: 'text-rose-500',
    accentDot: 'bg-rose-500',
  },
  memory: {
    key: 'memory',
    label: 'Memory Peak',
    aggregation: 'gauge',
    getValue: (r) => r.memory_peak ?? 0,
    format: (v) => formatReadableSize(v),
    tiers: [
      'bg-muted/50',
      'bg-amber-500/20',
      'bg-amber-500/40',
      'bg-amber-500/60',
      'bg-amber-500/80',
      'bg-amber-500',
    ],
    accentText: 'text-amber-600 dark:text-amber-500',
    accentDot: 'bg-amber-500',
  },
  duration: {
    key: 'duration',
    label: 'Avg Duration',
    aggregation: 'gauge',
    getValue: (r) => r.avg_duration_ms ?? 0,
    format: formatDurationMs,
    tiers: [
      'bg-muted/50',
      'bg-violet-500/20',
      'bg-violet-500/40',
      'bg-violet-500/60',
      'bg-violet-500/80',
      'bg-violet-500',
    ],
    accentText: 'text-violet-500',
    accentDot: 'bg-violet-500',
  },
  written: {
    key: 'written',
    label: 'Data Written',
    aggregation: 'sum',
    getValue: (r) => r.written_bytes ?? 0,
    format: (v) => formatReadableSize(v),
    tiers: [
      'bg-muted/50',
      'bg-emerald-500/20',
      'bg-emerald-500/40',
      'bg-emerald-500/60',
      'bg-emerald-500/80',
      'bg-emerald-500',
    ],
    accentText: 'text-emerald-600 dark:text-emerald-500',
    accentDot: 'bg-emerald-500',
  },
}

/** Metric configs in the order their switch pills should appear. */
export const METRIC_ORDER: MetricKey[] = [
  'queries',
  'failed',
  'memory',
  'duration',
  'written',
]

/**
 * Default intensity ramp (query mode). Exported for the legend fallback and for
 * back-compat with existing tests. Tier 0 is empty / no-activity.
 */
export const INTENSITY_TIERS = METRIC_CONFIGS.queries.tiers

// Ratio (value / max) at or above which a cell takes the matching tier.
export const TIER_THRESHOLDS = [0, 0.01, 0.25, 0.5, 0.75] as const

/**
 * Map an absolute value to a Tailwind background class for its intensity within
 * the given tier ramp (defaults to the query ramp).
 */
export function getIntensityClass(
  value: number,
  max: number,
  tiers: readonly string[] = INTENSITY_TIERS
): string {
  if (max <= 0 || value <= 0) return tiers[0]
  const ratio = value / max
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (ratio >= TIER_THRESHOLDS[i]) return tiers[i + 1]
  }
  return tiers[0]
}
