import {
  countFeatureBulletsInMarkdown,
  groupChangelogFeatures,
  parseChangelogFeatures,
} from './parse-changelog-features'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CHANGELOG_PATH = fileURLToPath(
  new URL('../../../../CHANGELOG.md', import.meta.url)
)

describe('parseChangelogFeatures', () => {
  const markdown = readFileSync(CHANGELOG_PATH, 'utf8')

  test('parsed count matches regex count over root CHANGELOG.md', () => {
    const parsed = parseChangelogFeatures(markdown)
    const regexCount = countFeatureBulletsInMarkdown(markdown)
    expect(parsed.length).toBe(regexCount)
    expect(parsed.length).toBeGreaterThan(100)
  })

  test('exposes every scope group with at least one feature', () => {
    const features = parseChangelogFeatures(markdown)
    const groups = groupChangelogFeatures(features)
    const groupedTotal = groups.reduce((n, g) => n + g.features.length, 0)

    expect(groups.length).toBeGreaterThan(10)
    expect(groupedTotal).toBe(features.length)
    for (const group of groups) {
      expect(group.scope.length).toBeGreaterThan(0)
      expect(group.features.length).toBeGreaterThan(0)
    }
  })
})
