import { describe, expect, test } from 'bun:test'

import { formatMicros, segmentWidthPct } from './format-micros'

describe('formatMicros', () => {
  test('sub-millisecond values render as µs', () => {
    expect(formatMicros(0)).toBe('0µs')
    expect(formatMicros(1)).toBe('1µs')
    expect(formatMicros(999)).toBe('999µs')
  })

  test('milliseconds render with adaptive precision', () => {
    expect(formatMicros(1000)).toBe('1.00ms')
    expect(formatMicros(9_999)).toBe('10.00ms')
    expect(formatMicros(12_300)).toBe('12.3ms')
  })

  test('seconds and minutes', () => {
    expect(formatMicros(1_200_000)).toBe('1.20s')
    expect(formatMicros(59_900_000)).toBe('59.90s')
    expect(formatMicros(125_000_000)).toBe('2m 5s')
  })

  test('non-finite / negative fall back to 0µs', () => {
    expect(formatMicros(NaN)).toBe('0µs')
    expect(formatMicros(-5)).toBe('0µs')
  })
})

describe('segmentWidthPct', () => {
  test('the max-total row spans 100%', () => {
    expect(segmentWidthPct(100, 100)).toBe(100)
  })

  test('scales proportionally and never exceeds 100', () => {
    expect(segmentWidthPct(25, 100)).toBe(25)
    expect(segmentWidthPct(150, 100)).toBe(100)
  })

  test('zero / negative max is safe (no NaN)', () => {
    expect(segmentWidthPct(50, 0)).toBe(0)
    expect(segmentWidthPct(50, -1)).toBe(0)
  })
})
