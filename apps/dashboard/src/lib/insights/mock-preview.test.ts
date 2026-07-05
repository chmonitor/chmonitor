import { buildMockInsights } from './mock-preview'
import { DEFAULT_INSIGHTS_SETTINGS } from './settings'
import { describe, expect, test } from 'bun:test'

describe('buildMockInsights', () => {
  test('is deterministic for the same inputs (SSR-safe, no randomness)', () => {
    const a = buildMockInsights(0, DEFAULT_INSIGHTS_SETTINGS, 0)
    const b = buildMockInsights(0, DEFAULT_INSIGHTS_SETTINGS, 0)
    expect(a).toEqual(b)
    expect(a).toHaveLength(3)
  })

  test('every card has a stable dismissal key and required fields', () => {
    for (const card of buildMockInsights(2, DEFAULT_INSIGHTS_SETTINGS)) {
      expect(card.key).toContain('2:')
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.detail.length).toBeGreaterThan(0)
    }
  })

  test('seed rotates which templates are shown', () => {
    const s0 = buildMockInsights(0, DEFAULT_INSIGHTS_SETTINGS, 0)
    const s1 = buildMockInsights(0, DEFAULT_INSIGHTS_SETTINGS, 1)
    expect(s0.map((c) => c.title)).not.toEqual(s1.map((c) => c.title))
  })

  test('enrich=false yields the terse deterministic copy; enrich=true is richer', () => {
    const off = buildMockInsights(0, {
      ...DEFAULT_INSIGHTS_SETTINGS,
      enrich: false,
    })
    const on = buildMockInsights(0, {
      ...DEFAULT_INSIGHTS_SETTINGS,
      enrich: true,
      promptStyle: 'detailed',
    })
    // Same first card, but the enriched detail is longer than the raw metric line.
    expect(on[0].detail.length).toBeGreaterThan(off[0].detail.length)
  })

  test('window is interpolated into enriched copy, never leaks the {window} token', () => {
    const cards = buildMockInsights(0, {
      ...DEFAULT_INSIGHTS_SETTINGS,
      enrich: true,
      promptStyle: 'detailed',
      window: '24 HOUR',
    })
    const joined = cards.map((c) => c.detail).join(' ')
    expect(joined).toContain('the last 24 hours')
    expect(joined).not.toContain('{window}')
  })
})
