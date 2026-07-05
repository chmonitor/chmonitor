import {
  augmentWithBand,
  computeMovingAverageBand,
  OVERLAY_KEYS,
} from './anomaly-overlay'
import { describe, expect, test } from 'bun:test'

describe('computeMovingAverageBand', () => {
  test('average uses at most `window` PRIOR points (excludes current)', () => {
    const out = computeMovingAverageBand([2, 4, 6, 8], 2, 2)
    // Prior-window: ma[2] = mean(2,4) = 3; ma[3] = mean(4,6) = 5
    expect(out[2].ma).toBe(3)
    expect(out[3].ma).toBe(5)
  })

  test('flat series has zero-width band and flags no anomalies', () => {
    const out = computeMovingAverageBand([5, 5, 5, 5], 3, 2)
    expect(out.every((p) => p.anomaly === false)).toBe(true)
    const last = out[3]
    expect(last.band?.[0]).toBe(5)
    expect(last.band?.[1]).toBe(5)
  })

  test('a spike outside the band is flagged once the window is full', () => {
    // Steady ~10 then a 100 spike; with a full window and non-zero σ it's an anomaly.
    const out = computeMovingAverageBand([10, 11, 9, 10, 100], 4, 2)
    expect(out[4].anomaly).toBe(true)
  })

  test('early points (partial window) are never anomalies', () => {
    const out = computeMovingAverageBand([100, 1, 1, 1], 4, 2)
    expect(out[0].anomaly).toBe(false)
    expect(out[1].anomaly).toBe(false)
  })

  test('nulls/NaN are gaps: null band point, skipped in later averages', () => {
    const out = computeMovingAverageBand([10, null, 20], 3, 2)
    expect(out[1].ma).toBe(10) // prior window is just the real 10
    expect(out[2].ma).toBe(10) // prior window skips the null, uses 10 (excludes current 20)
    const gapOut = computeMovingAverageBand([null], 3, 2)
    expect(gapOut[0]).toEqual({ ma: null, band: null, anomaly: false })
  })

  test('window and k are clamped to sane minimums', () => {
    // window 0 → 1 (one prior point); k negative → 0-width band.
    const out = computeMovingAverageBand([3, 7], 0, -5)
    expect(out[1].ma).toBe(3) // the single prior point
    expect(out[1].band).toEqual([3, 3])
  })
})

describe('augmentWithBand', () => {
  test('adds overlay keys to every row and collects anomaly points', () => {
    const data = [
      { t: 'a', v: 10 },
      { t: 'b', v: 11 },
      { t: 'c', v: 9 },
      { t: 'd', v: 10 },
      { t: 'e', v: 100 },
    ]
    const { rows, anomalies } = augmentWithBand(data, 't', 'v', 4, 2)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveProperty(OVERLAY_KEYS.ma)
    expect(rows[0]).toHaveProperty(OVERLAY_KEYS.band)
    expect(anomalies).toEqual([{ indexValue: 'e', value: 100 }])
  })
})
