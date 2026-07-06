import { HERO_DEMO_TABS, heroDemoPreviewForTab } from './hero-demo'
import { describe, expect, test } from 'bun:test'

describe('hero demo tabs', () => {
  test('every tab id maps to a non-empty preview descriptor', () => {
    for (const tab of HERO_DEMO_TABS) {
      const preview = heroDemoPreviewForTab(tab.id)
      expect(preview).not.toBeNull()
      expect(preview?.headline.length).toBeGreaterThan(0)
      expect(preview?.description.length).toBeGreaterThan(0)
      expect(preview?.screenshotSrc.length).toBeGreaterThan(0)
      expect(preview?.screenshotAlt.length).toBeGreaterThan(0)
    }
  })

  test('unknown tab returns null', () => {
    expect(heroDemoPreviewForTab('nope')).toBeNull()
  })
})
