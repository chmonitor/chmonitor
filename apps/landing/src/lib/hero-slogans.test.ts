import { HERO_SLOGANS, heroSloganAt } from './hero-slogans'
import { describe, expect, test } from 'bun:test'

describe('hero slogans', () => {
  test('has multiple rotating lines', () => {
    expect(HERO_SLOGANS.length).toBeGreaterThanOrEqual(3)
  })

  test('heroSloganAt wraps indices', () => {
    const last = HERO_SLOGANS.length - 1
    expect(heroSloganAt(0)).toBe(HERO_SLOGANS[0])
    expect(heroSloganAt(last + 1)).toBe(HERO_SLOGANS[0])
    expect(heroSloganAt(-1)).toBe(HERO_SLOGANS[last])
  })
})
