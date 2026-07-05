/**
 * Statistics Insights user settings — pure, isomorphic model.
 *
 * These per-user preferences (persisted client-side, like AI insight settings)
 * control the anomaly overlays drawn on the statistical charts (`/queries/insights`
 * and the Cluster Statistics sections): a moving-average line with a ±k·stddev
 * band, plus an optional absolute threshold line.
 *
 * Pure module (no React / server imports) so the client hook, the settings UI,
 * and the chart-overlay math can all share it.
 */

export interface StatsInsightsSettings {
  /** Moving-average window in data points. */
  readonly maWindow: number
  /** Band half-width as a multiple of the rolling standard deviation (±k·σ). */
  readonly bandMultiplier: number
  /**
   * Absolute horizontal threshold value, or null when no absolute threshold is
   * set (only the moving-average band flags anomalies).
   */
  readonly threshold: number | null
  /** Draw the moving-average line + ±k·σ band. */
  readonly showMovingAverage: boolean
  /** Draw the absolute threshold line (only meaningful when `threshold` is set). */
  readonly showThreshold: boolean
}

export const MA_WINDOW_RANGE = { min: 3, max: 60 } as const
export const BAND_MULTIPLIER_RANGE = { min: 0.5, max: 5 } as const

export const DEFAULT_STATS_INSIGHTS_SETTINGS: StatsInsightsSettings = {
  maWindow: 7,
  bandMultiplier: 2,
  threshold: null,
  showMovingAverage: true,
  showThreshold: false,
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Coerce arbitrary input (parsed localStorage, query params) into valid
 * settings. Out-of-range / malformed fields fall back to defaults so a corrupt
 * payload never breaks the charts.
 */
export function sanitizeStatsInsightsSettings(
  input:
    | Partial<Record<keyof StatsInsightsSettings, unknown>>
    | null
    | undefined
): StatsInsightsSettings {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_STATS_INSIGHTS_SETTINGS }
  }

  const maWindow = Math.round(
    clampNumber(
      input.maWindow,
      MA_WINDOW_RANGE.min,
      MA_WINDOW_RANGE.max,
      DEFAULT_STATS_INSIGHTS_SETTINGS.maWindow
    )
  )

  const bandMultiplier = clampNumber(
    input.bandMultiplier,
    BAND_MULTIPLIER_RANGE.min,
    BAND_MULTIPLIER_RANGE.max,
    DEFAULT_STATS_INSIGHTS_SETTINGS.bandMultiplier
  )

  let threshold: number | null = null
  if (
    input.threshold !== null &&
    input.threshold !== undefined &&
    input.threshold !== ''
  ) {
    const n =
      typeof input.threshold === 'number'
        ? input.threshold
        : Number(input.threshold)
    threshold = Number.isFinite(n) && n > 0 ? n : null
  }

  const showMovingAverage =
    typeof input.showMovingAverage === 'boolean'
      ? input.showMovingAverage
      : input.showMovingAverage === 'true'
        ? true
        : input.showMovingAverage === 'false'
          ? false
          : DEFAULT_STATS_INSIGHTS_SETTINGS.showMovingAverage

  const showThreshold =
    typeof input.showThreshold === 'boolean'
      ? input.showThreshold
      : input.showThreshold === 'true'
        ? true
        : input.showThreshold === 'false'
          ? false
          : DEFAULT_STATS_INSIGHTS_SETTINGS.showThreshold

  return {
    maWindow,
    bandMultiplier,
    threshold,
    showMovingAverage,
    showThreshold,
  }
}
