import { colorForCategoryIndex } from './utils'
import { describe, expect, test } from 'bun:test'

describe('colorForCategoryIndex', () => {
  const palette = ['--chart-1', '--chart-2', '--chart-3']

  test('uses the explicit palette within range', () => {
    expect(colorForCategoryIndex(0, palette)).toBe('var(--chart-1)')
    expect(colorForCategoryIndex(2, palette)).toBe('var(--chart-3)')
  })

  test('generates a distinct hsl color beyond the palette (never var(undefined))', () => {
    const color = colorForCategoryIndex(3, palette)
    expect(color).not.toContain('undefined')
    expect(color).toMatch(/^hsl\(\d+ 70% 55%\)$/)
  })

  test('falls back to the 13 themed vars when no palette is given', () => {
    expect(colorForCategoryIndex(0)).toBe('var(--chart-1)')
    expect(colorForCategoryIndex(7)).toBe('var(--chart-8)')
    expect(colorForCategoryIndex(12)).toBe('var(--chart-13)')
  })

  test('beyond the 13 themed vars it generates hsl, not black', () => {
    const color = colorForCategoryIndex(13)
    expect(color).toMatch(/^hsl\(\d+ 70% 55%\)$/)
  })

  test('generated hues differ between successive overflow indices', () => {
    expect(colorForCategoryIndex(13)).not.toBe(colorForCategoryIndex(14))
  })
})
