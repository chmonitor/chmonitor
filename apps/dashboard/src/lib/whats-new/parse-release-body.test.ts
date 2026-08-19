import { extractMarkdownImages } from './images'
import { buildAirgapSnapshot, parseChangelogMarkdown } from './parse-changelog'
import { classifyHeading, stripToProductNotes } from './parse-release-body'
import { describe, expect, test } from 'bun:test'

const RECAP_BODY = `## 📊 Release recap

- 📦 **50 commits** across **50 pull requests**
- 🏆 Shoutout to **@github-actions[bot]**

## 🐳 Docker image

\`\`\`bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.3
\`\`\`

## 🔁 Full changelog

**Compare:** [\`v0.3.2...v0.3.3\`](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3)

---

## [0.3.3](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3) (2026-08-15)

### ✨ Features

* **nav:** drag to reorder pinned favorites

### 🐛 Bug Fixes

* **charts:** keep area fill when log scale is enabled

### ⚡ Performance

* **agent:** load the floating agent's chunk on first open

### ♻️ Refactoring

* **menu:** move Traffic under the Insights group

### 🧹 Chores

* bump deps
`

const HIGHLIGHTS_BODY = `> Compact settings rail and a faster agent widget.

### Highlights

- New What's new dialog
- ![Overview](https://example.com/overview.png)

### ✨ Features

* **ui:** add the What's new dialog

### 👷 CI

* hide refactor from the changelog
`

describe('classifyHeading', () => {
  test('keeps product sections and drops recap/internal', () => {
    expect(classifyHeading('### ✨ Features')).toBe('features')
    expect(classifyHeading('## 🐛 Bug Fixes')).toBe('fixes')
    expect(classifyHeading('## ⚡ Performance')).toBe('perf')
    expect(classifyHeading('### Highlights')).toBe('highlights')
    expect(classifyHeading('## 📊 Release recap')).toBe('drop')
    expect(classifyHeading('## 🐳 Docker image')).toBe('drop')
    expect(classifyHeading('### ♻️ Refactoring')).toBe('drop')
    expect(classifyHeading('## [0.3.3](https://example) (2026-08-15)')).toBe(
      'version'
    )
  })
})

describe('stripToProductNotes', () => {
  test('strips recap/docker and keeps features/fixes/perf', () => {
    const result = stripToProductNotes(RECAP_BODY)
    expect(result.markdown).toContain('Features')
    expect(result.markdown).toContain('pinned favorites')
    expect(result.markdown).toContain('Bug Fixes')
    expect(result.markdown).toContain('Performance')
    expect(result.markdown).not.toContain('Release recap')
    expect(result.markdown).not.toContain('Docker image')
    expect(result.markdown).not.toContain('Shoutout')
    expect(result.markdown).not.toContain('Refactoring')
    expect(result.markdown).not.toContain('Chores')
  })

  test('keeps a highlights blockquote and screenshot markdown', () => {
    const result = stripToProductNotes(HIGHLIGHTS_BODY)
    expect(result.highlights.some((h) => h.includes("What's new dialog"))).toBe(
      true
    )
    expect(result.markdown).toContain(
      '![Overview](https://example.com/overview.png)'
    )
    expect(result.markdown).toContain('Features')
    expect(result.markdown).not.toContain('CI')
    expect(extractMarkdownImages(result.markdown)).toEqual([
      { alt: 'Overview', url: 'https://example.com/overview.png' },
    ])
  })
})

describe('parseChangelogMarkdown', () => {
  test('parses version sections newest first and skips Unreleased without highlights', () => {
    const changelog = `# Changelog

## [Unreleased]

### ♻️ Refactoring

* internal only

## [0.3.3](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3) (2026-08-15)

### ✨ Features

* **nav:** drag to reorder pinned favorites

### ♻️ Refactoring

* **menu:** move Traffic under the Insights group

## [0.3.2](https://github.com/chmonitor/chmonitor/compare/v0.3.1...v0.3.2) (2026-08-12)

### 🐛 Bug Fixes

* **charts:** keep area fill
`

    const notes = parseChangelogMarkdown(changelog)
    expect(notes.map((n) => n.version)).toEqual(['0.3.3', '0.3.2'])
    expect(notes[0]?.publishedAt).toBe('2026-08-15T00:00:00.000Z')
    expect(notes[0]?.markdown).toContain('Features')
    expect(notes[0]?.markdown).not.toContain('Refactoring')
    expect(notes[1]?.tag).toBe('v0.3.2')
  })

  test('keeps Unreleased when it has Highlights', () => {
    const changelog = `## [Unreleased]

### Highlights

- Upcoming screenshot
- ![Next](https://example.com/next.png)

## [0.3.3](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3) (2026-08-15)

### ✨ Features

* **ui:** something
`
    const notes = parseChangelogMarkdown(changelog)
    expect(notes[0]?.tag).toBe('Unreleased')
    expect(notes[0]?.highlights[0]).toContain('Upcoming screenshot')
    expect(notes[0]?.markdown).toContain(
      '![Next](https://example.com/next.png)'
    )
  })

  test('buildAirgapSnapshot keeps latest v* product notes and skips Unreleased', () => {
    const changelog = `# Changelog

## [Unreleased]

### Highlights

- Upcoming

## [0.3.3](https://example) (2026-08-15)

### ✨ Features

* **ui:** dialog

### ♻️ Refactoring

* internal

## [0.3.2](https://example) (2026-08-12)

### ✨ Features

* **charts:** fill

### 🐛 Bug Fixes

* **charts:** fill leftover
`
    const notes = buildAirgapSnapshot(changelog, 5)
    expect(notes.map((n) => n.tag)).toEqual(['v0.3.3', 'v0.3.2'])
    expect(notes[0]?.markdown).toContain('Features')
    expect(notes[0]?.markdown).toContain('dialog')
    expect(notes[0]?.markdown).not.toContain('Refactoring')
    expect(notes[1]?.markdown).toContain('Features')
    expect(notes[1]?.markdown).not.toContain('Bug Fixes')
    expect(buildAirgapSnapshot(changelog, 1).map((n) => n.tag)).toEqual([
      'v0.3.3',
    ])
  })
})
