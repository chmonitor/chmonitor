/**
 * Tests for the statistical anomaly baseline fitter/scorer.
 *
 * `fitBaseline`/`scoreAnomaly` are pure (no ClickHouse/D1 I/O) and don't
 * exercise the store, but this module still transitively imports
 * `baseline-store.ts` -> `@chm/platform`, which apps/dashboard's tsconfig
 * aliases to a Cloudflare-Workers-only shim (`platform-native.ts`, importing
 * `cloudflare:workers`). Mocked the same way `insights/store/d1-store.test.ts`
 * does, so the import graph resolves under plain `bun test`. See
 * plans/48-statistical-anomaly-baselines.md.
 */

import type { Baseline } from './statistical-baseline'

import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => null }),
}))

const { fitBaseline, scoreAnomaly } = await import('./statistical-baseline')

/** Deterministic PRNG (mulberry32) so generated samples are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller normal samples, seeded for reproducibility. */
function normalSamples(
  n: number,
  mean: number,
  stddev: number,
  seed: number
): number[] {
  const rand = mulberry32(seed)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rand(), 1e-9)
    const u2 = rand()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    out.push(mean + z * stddev)
  }
  return out
}

describe('fitBaseline', () => {
  test('fits a mean/stddev close to the generating distribution on a clean normal sample', () => {
    const samples = normalSamples(200, 100, 10, 1)
    const baseline = fitBaseline('0', 'error_rate', samples)

    expect(baseline.sampleCount).toBeGreaterThan(150)
    expect(Math.abs(baseline.mean - 100)).toBeLessThan(3)
    expect(Math.abs(baseline.stddev - 10)).toBeLessThan(3)
  })

  test('rejects injected outliers so they do not blow up the fitted mean/stddev', () => {
    const clean = normalSamples(200, 100, 5, 2)
    const withOutliers = [...clean, 5000, -5000, 8000, 10000, 12000]

    const cleanBaseline = fitBaseline('0', 'query_duration_p95', clean)
    const outlierBaseline = fitBaseline('0', 'query_duration_p95', withOutliers)

    // The injected outliers must be excluded from the fit.
    expect(outlierBaseline.sampleCount).toBeLessThan(withOutliers.length)
    expect(outlierBaseline.sampleCount).toBeGreaterThanOrEqual(
      cleanBaseline.sampleCount
    )
    // Mean/stddev stay close to the clean-sample fit rather than being
    // dragged toward the outliers.
    expect(Math.abs(outlierBaseline.mean - cleanBaseline.mean)).toBeLessThan(5)
    expect(outlierBaseline.stddev).toBeLessThan(cleanBaseline.stddev * 3)
  })

  test('guards the empty-sample case with a zero-variance baseline (no throw)', () => {
    const baseline = fitBaseline('0', 'memory_usage', [])
    expect(baseline.sampleCount).toBe(0)
    expect(baseline.stddev).toBe(0)
    expect(baseline.mean).toBe(0)
  })

  test('guards constant samples (MAD = 0) without dividing by zero', () => {
    const baseline = fitBaseline('0', 'memory_usage', [42, 42, 42, 42, 42])
    expect(baseline.mad).toBe(0)
    expect(baseline.mean).toBe(42)
    expect(baseline.stddev).toBe(0)
    expect(baseline.sampleCount).toBe(5)
  })

  test('fits a representative 7-day hourly sample set (168 points) in under 100ms', () => {
    const samples = normalSamples(168, 50, 5, 7)
    const start = performance.now()
    fitBaseline('0', 'error_rate', samples)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })
})

describe('scoreAnomaly', () => {
  const baseline: Baseline = {
    hostId: '0',
    metric: 'error_rate',
    mean: 100,
    stddev: 10,
    median: 100,
    mad: 7,
    sampleCount: 168,
    windowStart: Date.now() - 7 * 24 * 60 * 60 * 1000,
    fittedAt: Date.now(),
  }

  test('flags |z| > 2 as anomalous', () => {
    const score = scoreAnomaly(125, baseline) // z = 2.5
    expect(score.usedBaseline).toBe(true)
    expect(score.z).toBeCloseTo(2.5, 5)
    expect(score.isAnomaly).toBe(true)
  })

  test('does not flag a value within the normal band', () => {
    const score = scoreAnomaly(105, baseline) // z = 0.5
    expect(score.usedBaseline).toBe(true)
    expect(score.isAnomaly).toBe(false)
  })

  test('a value exactly at the threshold is not flagged (strictly greater than)', () => {
    const score = scoreAnomaly(120, baseline) // z = 2.0 exactly
    expect(score.isAnomaly).toBe(false)
  })

  test('baseline == null (cold start) resolves to usedBaseline: false', () => {
    const score = scoreAnomaly(1000, null)
    expect(score.usedBaseline).toBe(false)
    expect(score.isAnomaly).toBe(false)
    expect(score.z).toBe(0)
  })

  test('a degenerate (zero-variance) baseline also resolves to usedBaseline: false', () => {
    const degenerate: Baseline = { ...baseline, stddev: 0 }
    const score = scoreAnomaly(999, degenerate)
    expect(score.usedBaseline).toBe(false)
  })

  test('a zero-sample baseline resolves to usedBaseline: false', () => {
    const empty: Baseline = { ...baseline, sampleCount: 0 }
    const score = scoreAnomaly(999, empty)
    expect(score.usedBaseline).toBe(false)
  })

  test('low sample count is surfaced as low confidence', () => {
    const lowN: Baseline = { ...baseline, sampleCount: 10 }
    const score = scoreAnomaly(200, lowN)
    expect(score.usedBaseline).toBe(true)
    expect(score.confidence).toBe('low')
  })

  test('a well-sampled baseline is surfaced as high confidence', () => {
    const score = scoreAnomaly(105, baseline) // sampleCount 168
    expect(score.confidence).toBe('high')
  })
})
