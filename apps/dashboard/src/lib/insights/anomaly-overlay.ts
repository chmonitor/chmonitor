/**
 * Client-side anomaly overlay math for the statistical charts.
 *
 * Given a single numeric series, computes a trailing moving average and a
 * ±k·σ band around it; points that fall outside the band are flagged as
 * anomalies. Pure and deterministic (no time, no randomness) so it is safe for
 * SSR/prerender and easy to unit-test. Consumed by the AreaChart primitive when
 * a chart opts into `anomalyOverlay`, parameterized by `useStatsInsightsSettings`.
 */

export interface BandPoint {
  /** Trailing moving-average value, or null until the window has any data. */
  readonly ma: number | null
  /** `[lower, upper]` band bounds, or null when no average exists. */
  readonly band: readonly [number, number] | null
  /** True when the point's value lies outside the band (an anomaly). */
  readonly anomaly: boolean
}

/** Population standard deviation of a non-empty numeric list. */
function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Compute a trailing moving-average band for `values`.
 *
 * The window is the *prior* points (it excludes the current point), so the band
 * is a baseline of recent history the current value is judged against — this
 * avoids self-masking.
 *
 * - `window` is the number of prior points averaged (clamped to ≥1).
 * - `k` is the band half-width in standard deviations (clamped to ≥0).
 * - `null`/`NaN` entries are gaps: they produce a null band point and are
 *   skipped when building later windows.
 */
export function computeMovingAverageBand(
  values: readonly (number | null)[],
  window: number,
  k: number
): BandPoint[] {
  const w = Math.max(1, Math.floor(window))
  const mult = Math.max(0, k)

  return values.map((value, i) => {
    const current =
      typeof value === 'number' && Number.isFinite(value) ? value : null

    // Collect up to `w` prior real numbers ending at i-1. Excluding the current
    // point keeps a spike from inflating its own band and masking itself —
    // especially at small window sizes.
    const win: number[] = []
    for (let j = i - 1; j >= 0 && win.length < w; j--) {
      const v = values[j]
      if (typeof v === 'number' && Number.isFinite(v)) win.push(v)
    }

    if (win.length === 0) {
      return { ma: null, band: null, anomaly: false }
    }

    const mean = win.reduce((a, b) => a + b, 0) / win.length
    const sd = stddev(win, mean)
    const band: [number, number] = [mean - mult * sd, mean + mult * sd]
    const anomaly =
      current !== null &&
      // Require a full prior window so early points (partial history) never
      // read as anomalies. A zero-width band (flat history) still flags a value
      // that differs from it — a spike off a flat baseline.
      win.length >= w &&
      (current < band[0] || current > band[1])

    return { ma: mean, band, anomaly }
  })
}

/** Keys the overlay adds to each chart row. Prefixed to avoid clashing with data columns. */
export const OVERLAY_KEYS = {
  ma: '__ma',
  band: '__maBand',
  anomaly: '__anomaly',
} as const

export interface AugmentedRow extends Record<string, unknown> {
  readonly __ma?: number | null
  readonly __maBand?: readonly [number, number] | null
  readonly __anomaly?: boolean
}

/**
 * Augment chart rows with overlay keys computed from `category`. Returns the
 * rows with `__ma` / `__maBand` / `__anomaly` added, plus the anomaly rows
 * (with their index value) so the caller can draw markers.
 */
export function augmentWithBand(
  data: readonly Record<string, unknown>[],
  index: string,
  category: string,
  window: number,
  k: number
): {
  rows: AugmentedRow[]
  anomalies: { indexValue: unknown; value: number }[]
} {
  const values = data.map((row) => {
    const v = row[category]
    return typeof v === 'number' ? v : v == null ? null : Number(v)
  })
  const band = computeMovingAverageBand(values, window, k)
  const anomalies: { indexValue: unknown; value: number }[] = []

  const rows = data.map((row, i) => {
    const point = band[i]
    if (point.anomaly && typeof values[i] === 'number') {
      anomalies.push({ indexValue: row[index], value: values[i] as number })
    }
    return {
      ...row,
      [OVERLAY_KEYS.ma]: point.ma,
      [OVERLAY_KEYS.band]: point.band,
      [OVERLAY_KEYS.anomaly]: point.anomaly,
    }
  })

  return { rows, anomalies }
}
