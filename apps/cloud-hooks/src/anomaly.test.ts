/**
 * Usage anomaly detection — the guards that keep this from crying wolf.
 */

import {
  DEFAULT_DROP_THRESHOLD,
  detectAnomaly,
  formatAnomaly,
  MIN_BASELINE,
  median,
} from './anomaly'
import { describe, expect, test } from 'bun:test'

const REF = '2026-07-24'

/** A flat baseline of `n` for the 7 days before REF, plus REF at `current`. */
function series(baselineValue: number, current: number) {
  const days = [
    '2026-07-17',
    '2026-07-18',
    '2026-07-19',
    '2026-07-20',
    '2026-07-21',
    '2026-07-22',
    '2026-07-23',
  ]
  return [
    ...days.map((day) => ({ day, n: baselineValue })),
    { day: REF, n: current },
  ]
}

describe('median', () => {
  test('is the middle value, and averages the middle pair when even', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  test('is 0 for an empty list', () => {
    expect(median([])).toBe(0)
  })
})

describe('detectAnomaly', () => {
  test('flags a drop past the threshold', () => {
    const anomaly = detectAnomaly(series(100, 50), REF)
    expect(anomaly?.kind).toBe('drop')
    expect(anomaly?.changePct).toBe(-50)
    expect(anomaly?.baseline).toBe(100)
  })

  test('stays silent for ordinary day-to-day movement', () => {
    // 15% down is a Tuesday, not an incident.
    expect(detectAnomaly(series(100, 85), REF)).toBeNull()
  })

  test('uses the median so one viral day cannot poison the baseline', () => {
    // A single 1000-install spike would drag a MEAN to ~230 and make a normal
    // 100 look like a 57% collapse. The median ignores it.
    const withSpike = [
      { day: '2026-07-17', n: 100 },
      { day: '2026-07-18', n: 100 },
      { day: '2026-07-19', n: 1000 },
      { day: '2026-07-20', n: 100 },
      { day: '2026-07-21', n: 100 },
      { day: REF, n: 100 },
    ]
    expect(detectAnomaly(withSpike, REF)).toBeNull()
  })

  test('ignores baselines too small for a percentage to mean anything', () => {
    // 3 → 1 is "-67%" and is pure noise.
    expect(detectAnomaly(series(3, 1), REF)).toBeNull()
    // Right at the floor it starts reporting.
    expect(detectAnomaly(series(MIN_BASELINE, 0), REF)?.kind).toBe('drop')
  })

  test('treats a missing reference day as zero — silence IS the signal', () => {
    // No row for yesterday means nothing reported at all: telemetry is down.
    const noToday = series(100, 0).filter((row) => row.day !== REF)
    const anomaly = detectAnomaly(noToday, REF)
    expect(anomaly?.kind).toBe('drop')
    expect(anomaly?.current).toBe(0)
  })

  test('flags a large spike but needs a much bigger move than a drop', () => {
    expect(detectAnomaly(series(100, 200), REF)).toBeNull() // 2x — not yet
    expect(detectAnomaly(series(100, 300), REF)?.kind).toBe('spike')
  })

  test('returns null when there is no baseline to compare against', () => {
    expect(detectAnomaly([{ day: REF, n: 5 }], REF)).toBeNull()
    expect(detectAnomaly([], REF)).toBeNull()
  })

  test('honours a caller-supplied threshold', () => {
    expect(
      detectAnomaly(series(100, 85), REF, { dropThreshold: 0.1 })?.kind
    ).toBe('drop')
    expect(DEFAULT_DROP_THRESHOLD).toBe(0.3)
  })
})

describe('formatAnomaly', () => {
  test('a drop states the magnitude and what usually causes it', () => {
    const text = formatAnomaly({
      kind: 'drop',
      current: 50,
      baseline: 100,
      changePct: -50,
      referenceDay: REF,
    })
    expect(text).toContain('dropped 50%')
    expect(text).toContain('baseline 100')
    expect(text).toContain('broken release')
  })

  test('a spike is phrased as news, not an incident', () => {
    const text = formatAnomaly({
      kind: 'spike',
      current: 300,
      baseline: 100,
      changePct: 200,
      referenceDay: REF,
    })
    expect(text).toContain('up 200%')
    expect(text).not.toContain('broken')
  })
})
