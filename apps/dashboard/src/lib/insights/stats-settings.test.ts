import {
  BAND_MULTIPLIER_RANGE,
  DEFAULT_STATS_INSIGHTS_SETTINGS,
  MA_WINDOW_RANGE,
  sanitizeStatsInsightsSettings,
} from './stats-settings'
import { describe, expect, test } from 'bun:test'

describe('sanitizeStatsInsightsSettings', () => {
  test('null/garbage input returns a fresh copy of defaults', () => {
    const a = sanitizeStatsInsightsSettings(null)
    expect(a).toEqual(DEFAULT_STATS_INSIGHTS_SETTINGS)
    // Must not hand back the shared module constant (callers may spread/mutate).
    expect(a).not.toBe(DEFAULT_STATS_INSIGHTS_SETTINGS)
    expect(sanitizeStatsInsightsSettings('nope' as unknown as null)).toEqual(
      DEFAULT_STATS_INSIGHTS_SETTINGS
    )
  })

  test('clamps maWindow to its range and rounds to an integer', () => {
    expect(sanitizeStatsInsightsSettings({ maWindow: 0 }).maWindow).toBe(
      MA_WINDOW_RANGE.min
    )
    expect(sanitizeStatsInsightsSettings({ maWindow: 999 }).maWindow).toBe(
      MA_WINDOW_RANGE.max
    )
    expect(sanitizeStatsInsightsSettings({ maWindow: 7.8 }).maWindow).toBe(8)
  })

  test('clamps bandMultiplier to its range', () => {
    expect(
      sanitizeStatsInsightsSettings({ bandMultiplier: 0 }).bandMultiplier
    ).toBe(BAND_MULTIPLIER_RANGE.min)
    expect(
      sanitizeStatsInsightsSettings({ bandMultiplier: 100 }).bandMultiplier
    ).toBe(BAND_MULTIPLIER_RANGE.max)
  })

  test('threshold: positive numbers pass, non-positive/blank/garbage → null', () => {
    expect(sanitizeStatsInsightsSettings({ threshold: 1000 }).threshold).toBe(
      1000
    )
    expect(sanitizeStatsInsightsSettings({ threshold: '250' }).threshold).toBe(
      250
    )
    expect(sanitizeStatsInsightsSettings({ threshold: 0 }).threshold).toBeNull()
    expect(
      sanitizeStatsInsightsSettings({ threshold: -5 }).threshold
    ).toBeNull()
    expect(
      sanitizeStatsInsightsSettings({ threshold: '' }).threshold
    ).toBeNull()
    expect(
      sanitizeStatsInsightsSettings({ threshold: 'abc' }).threshold
    ).toBeNull()
  })

  test('coerces boolean toggles from query-string strings', () => {
    expect(
      sanitizeStatsInsightsSettings({ showMovingAverage: 'false' })
        .showMovingAverage
    ).toBe(false)
    expect(
      sanitizeStatsInsightsSettings({ showThreshold: 'true' }).showThreshold
    ).toBe(true)
  })
})
