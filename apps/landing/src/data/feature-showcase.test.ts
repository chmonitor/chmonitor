import { FEATURE_SECTIONS } from './feature-showcase'
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const assetsDir = join(import.meta.dir, '../../public/landing-assets')

describe('feature showcase sections', () => {
  test('every section has id, copy and screenshot', () => {
    expect(FEATURE_SECTIONS.length).toBeGreaterThanOrEqual(6)
    for (const section of FEATURE_SECTIONS) {
      expect(section.id.startsWith('feature-')).toBe(true)
      expect(section.title.length).toBeGreaterThan(0)
      expect(section.bullets.length).toBeGreaterThan(0)
      expect(section.screenshot.src.startsWith('/landing-assets/')).toBe(true)
      expect(section.screenshot.alt.length).toBeGreaterThan(0)
    }
  })

  test('section ids are unique', () => {
    const ids = FEATURE_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('screenshot files exist on disk', () => {
    for (const section of FEATURE_SECTIONS) {
      const srcPath = join(
        assetsDir,
        section.screenshot.src.replace('/landing-assets/', '')
      )
      expect(existsSync(srcPath)).toBe(true)
      if (section.screenshot.srcDark) {
        const darkPath = join(
          assetsDir,
          section.screenshot.srcDark.replace('/landing-assets/', '')
        )
        expect(existsSync(darkPath)).toBe(true)
      }
    }
  })
})
