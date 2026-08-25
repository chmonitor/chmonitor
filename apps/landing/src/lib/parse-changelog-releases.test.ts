import {
  parseChangelogReleases,
  toProductReleaseTag,
} from './parse-changelog-releases'
import { describe, expect, test } from 'bun:test'

const SAMPLE = `# Changelog

## [Unreleased]

* **landing:** not shipped yet

## [0.3.4](https://github.com/chmonitor/chmonitor/compare/v0.3.3...v0.3.4) (2026-08-24)

### ✨ Features

* **advisor:** schema tab

## [0.3.3](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3) (2026-08-15)

### ✨ Features

* **dashboard:** what's new dialog

## [chm-v0.1.3](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.2...chm-v0.1.3) (2026-08-21)

### ✨ Features

* **cli:** TUI default
`

describe('toProductReleaseTag', () => {
  test('accepts product versions and rejects CLI / unreleased', () => {
    expect(toProductReleaseTag('0.3.4')).toBe('v0.3.4')
    expect(toProductReleaseTag('v0.3.4')).toBe('v0.3.4')
    expect(toProductReleaseTag('Unreleased')).toBeNull()
    expect(toProductReleaseTag('chm-v0.1.3')).toBeNull()
    expect(toProductReleaseTag('helm-chmonitor-0.2.15')).toBeNull()
  })
})

describe('parseChangelogReleases', () => {
  test('returns newest product versions and skips Unreleased plus CLI tags', () => {
    const releases = parseChangelogReleases(SAMPLE)
    expect(releases.map((r) => r.tag_name)).toEqual(['v0.3.4', 'v0.3.3'])
    expect(releases[0]?.published_at).toBe('2026-08-24T00:00:00.000Z')
    expect(releases[0]?.html_url).toBe(
      'https://github.com/chmonitor/chmonitor/releases/tag/v0.3.4'
    )
    expect(releases[0]?.body).toContain('schema tab')
    expect(releases.some((r) => r.tag_name.startsWith('chm-'))).toBe(false)
  })
})
