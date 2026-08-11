import {
  chartTickFormatters,
  cn,
  createDateTickFormatter,
  dedent,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercentage,
  getHost,
  uniq,
} from './utils'
import { describe, expect, test } from 'bun:test'

describe('cn', () => {
  test('merges class names and dedupes conflicting tailwind utilities', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4') // twMerge keeps the last
    expect(cn('text-sm', false, undefined, 'font-bold')).toBe(
      'text-sm font-bold'
    )
  })
})

describe('uniq', () => {
  test('removes duplicates preserving first-seen order', () => {
    expect(uniq([1, 2, 2, 3, 1])).toEqual([1, 2, 3])
    expect(uniq(['a', 'a'])).toEqual(['a'])
    expect(uniq([])).toEqual([])
  })
})

describe('dedent', () => {
  test('strips the common leading indentation', () => {
    expect(dedent('    a\n    b')).toBe('a\nb')
  })

  test('uses the minimum indent across lines', () => {
    expect(dedent('  a\n      b')).toBe('a\n    b')
  })

  test('trims leading and trailing blank lines', () => {
    expect(dedent('\n  x\n  ')).toBe('x')
  })

  test('returns unchanged when there is no indentation', () => {
    expect(dedent('a\nb')).toBe('a\nb')
  })
})

describe('getHost', () => {
  test('extracts host (with port) from a URL', () => {
    expect(getHost('https://example.com:8123/path')).toBe('example.com:8123')
    expect(getHost('http://localhost')).toBe('localhost')
  })

  test('returns empty string for missing input', () => {
    expect(getHost()).toBe('')
    expect(getHost('')).toBe('')
  })
})

describe('formatBytes', () => {
  test('handles zero, negative and non-finite', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('-')
    expect(formatBytes(Number.NaN)).toBe('-')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('-')
  })

  test('scales through binary units with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  test('caps at the largest unit', () => {
    expect(formatBytes(1024 ** 6)).toContain('PB')
  })

  test('clamps the low end for values between 0 and 1', () => {
    expect(formatBytes(0.5)).toBe('0.5 B')
    expect(formatBytes(0.001)).toBe('0.0 B')
  })
})

describe('formatPercentage', () => {
  test('one decimal with a percent sign', () => {
    expect(formatPercentage(12.345)).toBe('12.3%')
    expect(formatPercentage(0)).toBe('0.0%')
  })
})

describe('formatCount', () => {
  test('invalid / negative collapse to dash', () => {
    expect(formatCount(-1)).toBe('-')
    expect(formatCount(Number.NaN)).toBe('-')
  })

  test('below 1000 prints the integer', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
  })

  test('scales with K/M/B/T suffixes', () => {
    expect(formatCount(1500)).toBe('1.5K')
    expect(formatCount(2_000_000)).toBe('2.0M')
    expect(formatCount(3_000_000_000)).toBe('3.0B')
  })

  test('clamps the low end for values between 0 and 1', () => {
    expect(formatCount(0.5)).toBe('0.5')
  })
})

describe('formatDuration', () => {
  test('invalid values collapse to dash', () => {
    expect(formatDuration(Number.NaN)).toBe('-')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('-')
  })

  test('chooses ms / s / m / h by magnitude', () => {
    expect(formatDuration(250)).toBe('250ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(90_000)).toBe('1.5m')
    expect(formatDuration(5_400_000)).toBe('1.5h')
  })

  test('preserves negative sign while formatting by absolute magnitude', () => {
    expect(formatDuration(-5)).toBe('-5ms')
    expect(formatDuration(-1500)).toBe('-1.5s')
    expect(formatDuration(-90_000)).toBe('-1.5m')
    expect(formatDuration(-5_400_000)).toBe('-1.5h')
  })
})

describe('chartTickFormatters', () => {
  test('null / undefined render as dash for every formatter', () => {
    for (const key of ['bytes', 'percentage', 'count', 'duration'] as const) {
      expect(chartTickFormatters[key](null)).toBe('-')
      expect(chartTickFormatters[key](undefined)).toBe('-')
    }
  })

  test('delegate to the underlying formatter', () => {
    expect(chartTickFormatters.bytes(1024)).toBe('1.0 KB')
    expect(chartTickFormatters.count(1500)).toBe('1.5K')
    expect(chartTickFormatters.default('label')).toBe('label')
    expect(chartTickFormatters.default(42)).toBe('42')
  })
})

describe('createDateTickFormatter', () => {
  const iso = '2026-01-15T13:05:00.000Z'

  test('empty input returns empty string', () => {
    expect(createDateTickFormatter(24)('')).toBe('')
  })

  test('invalid date returns the raw value', () => {
    expect(createDateTickFormatter(24)('not-a-date')).toBe('not-a-date')
  })

  test('≤24h shows time only (UTC pinned)', () => {
    expect(createDateTickFormatter(24, 'UTC')(iso)).toBe('13:05')
  })

  test('≤7d shows month/day + time', () => {
    const out = createDateTickFormatter(48, 'UTC')(iso)
    expect(out).toContain('Jan')
    expect(out).toContain('15')
  })

  test('>7d shows month/day only', () => {
    const out = createDateTickFormatter(24 * 30, 'UTC')(iso)
    expect(out).toContain('Jan')
    expect(out).not.toContain(':')
  })
})
