/**
 * The Slack sparkline: an alert's recent values as one monospace line, since
 * Block Kit has no chart block. The arrow reads first → last value, so a
 * falling series must read as falling.
 */

import { buildSlackSparkline } from '../slack-chart'
import { describe, expect, test } from 'bun:test'

describe('buildSlackSparkline', () => {
  test('a rising series with its threshold', () => {
    expect(buildSlackSparkline([12, 30, 55, 80, 97], { warn: 80 })).toBe(
      '`▁▂▅▇█ 12 → 97 (warn 80)`'
    )
  })

  test('a falling series reads first → last, not min → max', () => {
    expect(buildSlackSparkline([97, 80, 55, 30, 12])).toBe('`█▇▅▂▁ 97 → 12`')
  })

  test('labels the min or max only when neither end shows it', () => {
    expect(buildSlackSparkline([50, 10, 60, 100])).toBe(
      '`▄▁▅█ 50 → 100 (min 10)`'
    )
    expect(buildSlackSparkline([10, 90, 20], { warn: 80, crit: 90 })).toBe(
      '`▁█▂ 10 → 20 (max 90, warn 80, crit 90)`'
    )
  })

  test('no usable point draws nothing', () => {
    expect(buildSlackSparkline([])).toBe('')
    expect(
      buildSlackSparkline([Number.NaN, Number.POSITIVE_INFINITY, null])
    ).toBe('')
  })

  test('one point is one mid bar and its value', () => {
    expect(buildSlackSparkline([42], { warn: 80, crit: null })).toBe(
      '`▄ 42 (warn 80)`'
    )
  })

  test('a constant series is flat at mid height', () => {
    expect(buildSlackSparkline([5, 5, 5])).toBe('`▄▄▄ 5 → 5`')
  })

  test('gaps (NaN, null, undefined) are skipped', () => {
    expect(buildSlackSparkline([1, Number.NaN, null, undefined, 3])).toBe(
      '`▁█ 1 → 3`'
    )
  })

  test('decimals round to two places and negatives scale', () => {
    expect(buildSlackSparkline([0.123, 2.5])).toBe('`▁█ 0.12 → 2.5`')
    expect(buildSlackSparkline([-5, 0, 5])).toBe('`▁▅█ -5 → 5`')
  })

  test('a long series is cut to the width and keeps its spike', () => {
    const values = Array.from({ length: 1000 }, (_, i) =>
      i === 500 ? 500 : 10
    )
    expect(buildSlackSparkline(values)).toBe(
      `\`${'▁'.repeat(12)}█${'▁'.repeat(11)} 10 → 10 (max 500)\``
    )
    expect(buildSlackSparkline(values, { width: 4 })).toBe(
      '`▁▁█▁ 10 → 10 (max 500)`'
    )
  })
})
