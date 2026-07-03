/**
 * Shared types for the per-host/per-metric statistical anomaly baseline system.
 *
 * Extracted into a leaf module so the store (`baseline-store.ts`) and the fitter
 * (`statistical-baseline.ts`, whose `refitBaselineIfStale` calls the store) can
 * both depend on the types without importing each other — otherwise the two
 * modules form an import cycle (`no-circular` depcruise violation).
 */

/** A fitted per-host/per-metric baseline distribution. */
export interface Baseline {
  readonly hostId: string
  readonly metric: string
  readonly mean: number
  readonly stddev: number
  readonly median: number
  readonly mad: number
  readonly sampleCount: number
  readonly windowStart: number
  readonly fittedAt: number
}

/** Confidence in a baseline, driven by how many samples it was fit from. */
export type BaselineConfidence = 'low' | 'medium' | 'high'

/** Result of scoring a value against a baseline. */
export interface AnomalyScore {
  /** Standard deviations from the baseline mean; `0` when no baseline was used. */
  readonly z: number
  /** `true` when `|z|` exceeds the threshold (default 2). */
  readonly isAnomaly: boolean
  readonly confidence: BaselineConfidence
  /** `false` means the caller must fall back to its static threshold (cold start / degenerate baseline). */
  readonly usedBaseline: boolean
}
