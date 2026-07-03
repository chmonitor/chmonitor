import { isKnownChartIconName } from './icon'
import { describe, expect, test } from 'bun:test'

describe('isKnownChartIconName', () => {
  test('accepts a real lucide-react icon name', () => {
    expect(isKnownChartIconName('database')).toBe(true)
    expect(isKnownChartIconName('cpu')).toBe(true)
    expect(isKnownChartIconName('memory-stick')).toBe(true)
  })

  test('rejects an unknown icon name', () => {
    expect(isKnownChartIconName('not-a-real-icon-xyz')).toBe(false)
  })

  test('rejects PascalCase (lucide-react/dynamic keys are kebab-case)', () => {
    expect(isKnownChartIconName('Database')).toBe(false)
  })
})
