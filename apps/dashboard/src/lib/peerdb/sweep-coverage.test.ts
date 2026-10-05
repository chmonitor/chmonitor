import { formatSweepCoverage, summarizeSweepCoverage } from './sweep-coverage'
import { describe, expect, test } from 'bun:test'

describe('summarizeSweepCoverage', () => {
  test('a fully-read listing is not partial', () => {
    expect(summarizeSweepCoverage(72, 72)).toEqual({
      listed: 72,
      checked: 72,
      partial: false,
      unchecked: 0,
    })
  })

  test('fewer checked than listed is partial, with the exact shortfall', () => {
    // The #3687 case: a 72-mirror fleet, 50 read.
    expect(summarizeSweepCoverage(72, 50)).toEqual({
      listed: 72,
      checked: 50,
      partial: true,
      unchecked: 22,
    })
  })

  test('checked can never exceed listed', () => {
    // A caller reporting more checked than listed has a bug; it must not become
    // a negative shortfall that reads as "nothing was missed".
    const c = summarizeSweepCoverage(10, 12)
    expect(c.checked).toBe(10)
    expect(c.unchecked).toBe(0)
    expect(c.partial).toBe(false)
  })

  test('junk and negative counts clamp instead of throwing', () => {
    expect(summarizeSweepCoverage(Number.NaN, 5)).toEqual({
      listed: 0,
      checked: 0,
      partial: false,
      unchecked: 0,
    })
    expect(summarizeSweepCoverage(-3, -1).listed).toBe(0)
    // A listed-but-unreadable listing is a mirror with no signal: partial.
    expect(summarizeSweepCoverage(5, 0).partial).toBe(true)
  })
})

describe('formatSweepCoverage', () => {
  test('names both counts and says partial', () => {
    const line = formatSweepCoverage(summarizeSweepCoverage(72, 50))
    expect(line).toContain('50 of 72 mirrors checked')
    expect(line).toContain('22 unchecked')
    expect(line).toContain('partial')
  })

  test('a complete result says so, and never says partial', () => {
    const line = formatSweepCoverage(summarizeSweepCoverage(12, 12))
    expect(line).toContain('12 of 12 mirrors checked')
    expect(line).toContain('complete')
    expect(line).not.toContain('partial')
  })

  test("noun is the caller's", () => {
    const line = formatSweepCoverage(summarizeSweepCoverage(4, 2), 'peers')
    expect(line).toContain('2 of 4 peers checked')
  })

  test('a zero-mirror tick is complete, not partial', () => {
    const line = formatSweepCoverage(summarizeSweepCoverage(0, 0))
    expect(line).toBe('0 of 0 mirrors checked — complete')
  })
})
