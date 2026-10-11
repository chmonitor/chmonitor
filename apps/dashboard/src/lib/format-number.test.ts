import { formatCompactNumber, formatNumber } from './format-number'
import { formatCompactNumber as viaReadable } from './format-readable'
import { describe, expect, test } from 'bun:test'

describe('formatCompactNumber (Intl compact)', () => {
  test('values under 1000 are shown in full', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(999)).toBe('999')
  })

  test('large values use compact notation', () => {
    // Locale-dependent suffix; assert the magnitude letter is present.
    expect(formatCompactNumber(1_234_567)).toMatch(/M$/)
    expect(formatCompactNumber(45_678)).toMatch(/K$/)
  })

  test('negative values below the threshold stay full', () => {
    expect(formatCompactNumber(-500)).toBe('-500')
  })
})

describe('formatCompactNumber query-stats values (legacy K/M/B output)', () => {
  test.each([
    [999, '999'],
    [13247, '13.2K'],
    [1_400_000, '1.4M'],
    [2_500_000_000, '2.5B'],
  ])('%p -> %p', (input, expected) => {
    expect(formatCompactNumber(input)).toBe(expected)
  })

  test('format-readable re-exports the same function', () => {
    expect(viaReadable).toBe(formatCompactNumber)
  })
})

describe('formatNumber', () => {
  test('applies locale grouping', () => {
    // en-like locales group with commas; assert digits are preserved.
    expect(formatNumber(1234567).replace(/[^0-9]/g, '')).toBe('1234567')
  })
})
