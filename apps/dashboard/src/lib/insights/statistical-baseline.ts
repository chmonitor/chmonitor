/**
 * Per-host/per-metric statistical anomaly baselines.
 *
 * Replaces the insight collectors' fixed static thresholds with a distribution
 * fitted per host/metric over a ~7-day window of historical samples (median +
 * MAD/IQR outlier rejection, then mean/stddev on the cleaned set). A current
 * value is scored against that baseline as a z-score; `|z| > 2` is flagged as
 * anomalous. This module is detection-only — it never applies anything.
 *
 * Fail-open by design: {@link scoreAnomaly} returns `usedBaseline: false` when
 * no baseline exists yet (cold start) or the baseline is degenerate (zero
 * variance), so callers (see `collectors.ts`) must fall back to their existing
 * static threshold. See plans/48-statistical-anomaly-baselines.md.
 */

import type {
  AnomalyScore,
  Baseline,
  BaselineConfidence,
} from './baseline-types'

import { getBaseline, upsertBaseline } from './baseline-store'

// The Baseline/AnomalyScore/BaselineConfidence types live in the leaf module
// `baseline-types` so the store and this fitter can share them without importing
// each other (avoids a no-circular depcruise violation). Re-exported here so
// existing consumers can keep importing them from `statistical-baseline`.
export type {
  AnomalyScore,
  Baseline,
  BaselineConfidence,
} from './baseline-types'

/** Modified z-score cutoff (Iglewicz & Hoaglin) for rejecting outliers before fitting — the IQR-fence equivalent. */
const ROBUST_Z_OUTLIER_CUTOFF = 3.5
/** Scales MAD so it is a consistent estimator of the standard deviation under normality. */
const MAD_CONSISTENCY_CONSTANT = 0.6745

/** Below this sample count a fitted baseline is labeled low-confidence (still used, but flagged). */
const LOW_CONFIDENCE_SAMPLE_COUNT = 50
const MEDIUM_CONFIDENCE_SAMPLE_COUNT = 100

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** How long a fitted baseline is trusted before {@link refitBaselineIfStale} re-fits it. */
export const BASELINE_REFIT_STALENESS_MS = 24 * 60 * 60 * 1000

function median(sortedValues: number[]): number {
  const n = sortedValues.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid]
}

function confidenceFor(sampleCount: number): BaselineConfidence {
  if (sampleCount < LOW_CONFIDENCE_SAMPLE_COUNT) return 'low'
  if (sampleCount < MEDIUM_CONFIDENCE_SAMPLE_COUNT) return 'medium'
  return 'high'
}

/**
 * Fit a baseline from raw historical samples (expected to span ~7 days).
 *
 * Rejects outliers using the median + MAD (robust z-score, cutoff 3.5) before
 * computing mean/stddev, so a single spike inside the fitting window doesn't
 * skew the baseline it's meant to catch deviations from. Guards the degenerate
 * cases: an empty sample set yields a zero-variance baseline (which {@link
 * scoreAnomaly} treats as unusable), and a zero MAD (constant samples) skips
 * outlier rejection instead of dividing by zero.
 */
export function fitBaseline(
  hostId: string,
  metric: string,
  samples: number[]
): Baseline {
  const now = Date.now()
  const finite = samples.filter((n) => Number.isFinite(n))

  if (finite.length === 0) {
    return {
      hostId,
      metric,
      mean: 0,
      stddev: 0,
      median: 0,
      mad: 0,
      sampleCount: 0,
      windowStart: now - SEVEN_DAYS_MS,
      fittedAt: now,
    }
  }

  const sorted = [...finite].sort((a, b) => a - b)
  const med = median(sorted)
  const absDeviations = sorted
    .map((x) => Math.abs(x - med))
    .sort((a, b) => a - b)
  const mad = median(absDeviations)

  const cleaned =
    mad > 0
      ? finite.filter(
          (x) =>
            Math.abs((MAD_CONSISTENCY_CONSTANT * (x - med)) / mad) <=
            ROBUST_Z_OUTLIER_CUTOFF
        )
      : finite

  // If rejection removed everything (pathological input), fit on the raw
  // samples rather than producing an empty/degenerate baseline.
  const effective = cleaned.length > 0 ? cleaned : finite
  const mean = effective.reduce((sum, x) => sum + x, 0) / effective.length
  const variance =
    effective.reduce((sum, x) => sum + (x - mean) ** 2, 0) / effective.length

  return {
    hostId,
    metric,
    mean,
    stddev: Math.sqrt(variance),
    median: med,
    mad,
    sampleCount: effective.length,
    windowStart: now - SEVEN_DAYS_MS,
    fittedAt: now,
  }
}

/**
 * Score a current value against a fitted baseline.
 *
 * `baseline: null` (no baseline fitted yet — cold start) and a degenerate
 * baseline (zero samples or zero variance) both resolve to `usedBaseline:
 * false` so the caller falls back to its static threshold instead of dividing
 * by zero or trusting an empty fit.
 */
export function scoreAnomaly(
  value: number,
  baseline: Baseline | null,
  threshold = 2
): AnomalyScore {
  if (!baseline || baseline.sampleCount === 0 || baseline.stddev === 0) {
    return { z: 0, isAnomaly: false, confidence: 'low', usedBaseline: false }
  }

  const z = (value - baseline.mean) / baseline.stddev
  return {
    z,
    isAnomaly: Math.abs(z) > threshold,
    confidence: confidenceFor(baseline.sampleCount),
    usedBaseline: true,
  }
}

/**
 * Return a fresh-enough baseline for `hostId`/`metric`, refitting it from
 * `fetchSamples()` when missing or older than {@link BASELINE_REFIT_STALENESS_MS}.
 *
 * Best-effort: any store or sample-fetch failure resolves to whatever baseline
 * was already on file (possibly `null`) rather than throwing, so a refit
 * failure never blocks insight generation. `fetchSamples` is expected to run a
 * read-only ~7-day historical query; it's only invoked when a refit is
 * actually due, so serving an already-fresh baseline costs a single cheap
 * store read (no ClickHouse round trip).
 */
export async function refitBaselineIfStale(
  hostId: number,
  metric: string,
  fetchSamples: () => Promise<number[]>
): Promise<Baseline | null> {
  const hostKey = String(hostId)
  try {
    const existing = await getBaseline(hostKey, metric)
    if (
      existing &&
      Date.now() - existing.fittedAt < BASELINE_REFIT_STALENESS_MS
    ) {
      return existing
    }

    const samples = await fetchSamples()
    // Nothing to fit (e.g. transient query failure) — keep serving whatever
    // was already on file rather than discarding a good baseline.
    if (samples.length === 0) return existing

    const fitted = fitBaseline(hostKey, metric, samples)
    await upsertBaseline(fitted)
    return fitted
  } catch {
    return null
  }
}
