import {
  analyzeDataForLogScale,
  clampDataForLogScale,
  getYAxisDomain,
  LOG_SCALE_MIN,
  resolveYAxisScale,
} from './chart-scale'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// analyzeDataForLogScale
// ---------------------------------------------------------------------------

describe('analyzeDataForLogScale', () => {
  test('returns safe defaults for empty data array', () => {
    const result = analyzeDataForLogScale([], ['value'])
    expect(result).toEqual({
      shouldUseLog: false,
      minValue: 0,
      maxValue: 0,
      ratio: 1,
      hasZeroOrNegative: false,
    })
  })

  test('returns safe defaults when no matching category keys exist', () => {
    const data = [{ foo: 1 }, { foo: 2 }]
    const result = analyzeDataForLogScale(data, ['bar'])
    expect(result).toEqual({
      shouldUseLog: false,
      minValue: 0,
      maxValue: 0,
      ratio: 1,
      hasZeroOrNegative: false,
    })
  })

  test('returns safe defaults when all values are NaN', () => {
    const data = [{ v: NaN }, { v: NaN }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result).toEqual({
      shouldUseLog: false,
      minValue: 0,
      maxValue: 0,
      ratio: 1,
      hasZeroOrNegative: false,
    })
  })

  test('returns safe defaults when all values are strings (non-numeric)', () => {
    const data = [{ v: 'hello' }, { v: 'world' }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result).toEqual({
      shouldUseLog: false,
      minValue: 0,
      maxValue: 0,
      ratio: 1,
      hasZeroOrNegative: false,
    })
  })

  test('single positive value — ratio=1, no log scale', () => {
    const data = [{ v: 50 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.shouldUseLog).toBe(false)
    expect(result.minValue).toBe(50)
    expect(result.maxValue).toBe(50)
    expect(result.ratio).toBe(1) // 50/50
    expect(result.hasZeroOrNegative).toBe(false)
  })

  test('ratio below threshold (< 100) → no log scale', () => {
    // max/min = 99/1 = 99 < 100
    const data = [{ v: 1 }, { v: 99 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.shouldUseLog).toBe(false)
    expect(result.ratio).toBeCloseTo(99)
  })

  test('ratio exactly at threshold (100) → log scale', () => {
    const data = [{ v: 1 }, { v: 100 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.shouldUseLog).toBe(true)
    expect(result.ratio).toBeCloseTo(100)
  })

  test('ratio well above threshold (1000x) → log scale', () => {
    const data = [{ v: 1 }, { v: 1000 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.shouldUseLog).toBe(true)
    expect(result.minValue).toBe(1)
    expect(result.maxValue).toBe(1000)
    expect(result.ratio).toBeCloseTo(1000)
    expect(result.hasZeroOrNegative).toBe(false)
  })

  test('very large range (1 to 1_000_000) → log scale', () => {
    const data = [{ v: 1 }, { v: 500_000 }, { v: 1_000_000 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.shouldUseLog).toBe(true)
    expect(result.maxValue).toBe(1_000_000)
    expect(result.minValue).toBe(1)
  })

  test('data includes zero → hasZeroOrNegative=true, minValue=positive min', () => {
    const data = [{ v: 0 }, { v: 5 }, { v: 1000 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.hasZeroOrNegative).toBe(true)
    expect(result.minValue).toBe(5) // smallest positive
    expect(result.maxValue).toBe(1000)
    // shouldUseLog: ratio = 1000/5 = 200 ≥ 100 → true
    expect(result.shouldUseLog).toBe(true)
  })

  test('data includes negative values → hasZeroOrNegative=true', () => {
    const data = [{ v: -10 }, { v: 1 }, { v: 200 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.hasZeroOrNegative).toBe(true)
    expect(result.minValue).toBe(1)
    expect(result.maxValue).toBe(200)
  })

  test('all values zero or negative — maxValue reflects actual max, no log scale', () => {
    const data = [{ v: 0 }, { v: -5 }, { v: -1 }]
    const result = analyzeDataForLogScale(data, ['v'])
    // minPositive stays Infinity → edge-case branch triggers
    expect(result.shouldUseLog).toBe(false)
    expect(result.minValue).toBe(0)
    expect(result.maxValue).toBe(0)
    expect(result.ratio).toBe(1)
    // The loop set hasZeroOrNegative=true; the edge-case branch now reports it
    expect(result.hasZeroOrNegative).toBe(true)
  })

  test('multiple categories are all analyzed', () => {
    const data = [{ a: 1, b: 1000 }]
    const result = analyzeDataForLogScale(data, ['a', 'b'])
    expect(result.minValue).toBe(1)
    expect(result.maxValue).toBe(1000)
    expect(result.shouldUseLog).toBe(true)
  })

  test('category values of mixed numeric and non-numeric', () => {
    const data = [{ v: 'text' }, { v: 1 }, { v: 500 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.minValue).toBe(1)
    expect(result.maxValue).toBe(500)
  })

  test('NaN mixed with valid values is ignored', () => {
    const data = [{ v: NaN }, { v: 2 }, { v: 400 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.minValue).toBe(2)
    expect(result.maxValue).toBe(400)
    expect(result.ratio).toBeCloseTo(200)
    expect(result.shouldUseLog).toBe(true)
  })

  test('small fractional values below 1 as minPositive', () => {
    const data = [{ v: 0.01 }, { v: 100 }]
    const result = analyzeDataForLogScale(data, ['v'])
    expect(result.minValue).toBeCloseTo(0.01)
    expect(result.maxValue).toBe(100)
    expect(result.ratio).toBeCloseTo(10000)
    expect(result.shouldUseLog).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveYAxisScale
// ---------------------------------------------------------------------------

describe('resolveYAxisScale', () => {
  const noData: Record<string, unknown>[] = []
  const cats: string[] = []

  test('undefined scale → linear', () => {
    expect(resolveYAxisScale(undefined, noData, cats)).toBe('linear')
  })

  test('"linear" → linear', () => {
    expect(resolveYAxisScale('linear', noData, cats)).toBe('linear')
  })

  test('"log" → log (always, regardless of data)', () => {
    expect(resolveYAxisScale('log', noData, cats)).toBe('log')
    expect(resolveYAxisScale('log', [{ v: 0 }], ['v'])).toBe('log')
  })

  test('"auto" with small-ratio data → linear', () => {
    const data = [{ v: 1 }, { v: 10 }]
    expect(resolveYAxisScale('auto', data, ['v'])).toBe('linear')
  })

  test('"auto" with large-ratio data → log', () => {
    const data = [{ v: 1 }, { v: 1000 }]
    expect(resolveYAxisScale('auto', data, ['v'])).toBe('log')
  })

  test('"auto" with empty data → linear (no log recommendation)', () => {
    expect(resolveYAxisScale('auto', [], ['v'])).toBe('linear')
  })

  test('unknown/unsupported scale value falls back to linear', () => {
    // TypeScript guard — cast to any to simulate runtime unknown value
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveYAxisScale('unknown' as any, noData, cats)).toBe('linear')
  })
})

// ---------------------------------------------------------------------------
// getYAxisDomain
// ---------------------------------------------------------------------------

describe('getYAxisDomain', () => {
  const data = [{ v: 5 }, { v: 500 }]
  const cats = ['v']

  test('non-log scale → ["auto", "auto"]', () => {
    expect(getYAxisDomain(data, cats, false)).toEqual(['auto', 'auto'])
  })

  test('log scale → [1, "auto"] (LOG_SCALE_MIN = 1)', () => {
    expect(getYAxisDomain(data, cats, true)).toEqual([1, 'auto'])
  })

  test('log scale with empty data still returns [1, "auto"]', () => {
    expect(getYAxisDomain([], [], true)).toEqual([1, 'auto'])
  })

  test('non-log scale with empty data → ["auto", "auto"]', () => {
    expect(getYAxisDomain([], [], false)).toEqual(['auto', 'auto'])
  })

  test('data and categories params are ignored (underscore-prefixed in source)', () => {
    // Confirm that different data does not change the result structure
    const bigData = [{ x: 0 }, { x: 1_000_000 }]
    expect(getYAxisDomain(bigData, ['x'], true)).toEqual([1, 'auto'])
    expect(getYAxisDomain(bigData, ['x'], false)).toEqual(['auto', 'auto'])
  })
})

// ---------------------------------------------------------------------------
// clampDataForLogScale
//
// Regression coverage for the "log scale area chart becomes a line chart"
// bug: Recharts maps zero/negative values to `null` on a log axis, which
// breaks the Area's filled polygon into disconnected slivers around every
// such point instead of one continuous shape. clampDataForLogScale floors
// those values to LOG_SCALE_MIN before the data reaches the chart.
// ---------------------------------------------------------------------------

describe('clampDataForLogScale', () => {
  test('floors zero values to LOG_SCALE_MIN', () => {
    const data = [{ v: 0 }, { v: 10 }, { v: 1000 }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result).toEqual([{ v: LOG_SCALE_MIN }, { v: 10 }, { v: 1000 }])
  })

  test('floors negative values to LOG_SCALE_MIN', () => {
    const data = [{ v: -5 }, { v: 10 }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result).toEqual([{ v: LOG_SCALE_MIN }, { v: 10 }])
  })

  test('leaves positive values untouched', () => {
    const data = [{ v: 1 }, { v: 500 }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result).toEqual(data)
  })

  test('rows needing no change are returned reference-equal (no copy)', () => {
    const data = [{ v: 5 }, { v: 10 }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result[0]).toBe(data[0])
    expect(result[1]).toBe(data[1])
  })

  test('rows that are clamped are copies, not mutations of the original', () => {
    const data = [{ v: 0 }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result[0]).not.toBe(data[0])
    expect(data[0]?.v).toBe(0) // original untouched
    expect(result[0]?.v).toBe(LOG_SCALE_MIN)
  })

  test('only clamps the given categories, leaving other fields untouched', () => {
    const data = [{ v: 0, other: -1, t: '2024-01-01' }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result).toEqual([{ v: LOG_SCALE_MIN, other: -1, t: '2024-01-01' }])
  })

  test('multiple categories on the same row are each clamped independently', () => {
    const data = [{ a: 0, b: -3, c: 50 }]
    const result = clampDataForLogScale(data, ['a', 'b', 'c'])
    expect(result).toEqual([{ a: LOG_SCALE_MIN, b: LOG_SCALE_MIN, c: 50 }])
  })

  test('non-numeric and NaN values are left untouched', () => {
    const data = [{ v: 'n/a' }, { v: NaN }, { v: null }, { v: undefined }]
    const result = clampDataForLogScale(data, ['v'])
    expect(result).toEqual(data)
  })

  test('empty data returns empty array', () => {
    expect(clampDataForLogScale([], ['v'])).toEqual([])
  })

  test('mixed zero/negative/positive series stays finite end-to-end', () => {
    // Regression case matching the reported bug: a metric that dips to zero
    // between spikes (e.g. an error count) must not break the area fill.
    const data = [
      { t: '1', v: 0 },
      { t: '2', v: 10 },
      { t: '3', v: 0 },
      { t: '4', v: 1000 },
    ]
    const result = clampDataForLogScale(data, ['v'])
    for (const row of result) {
      expect(row.v).toBeGreaterThan(0)
      expect(Number.isFinite(row.v)).toBe(true)
    }
  })
})
