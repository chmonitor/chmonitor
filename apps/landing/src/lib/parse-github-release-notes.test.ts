import {
  classifyReleaseHeading,
  extractImages,
  isProductReleaseTag,
  mdToHtml,
  parseGithubReleaseNotes,
} from './parse-github-release-notes'
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

### Highlights

- Compact settings rail
- ![Overview](https://example.com/overview.png)

### ✨ Features

* **nav:** drag to reorder pinned favorites
* **ui:** add the What's new dialog

### 🐛 Bug Fixes

* **charts:** keep area fill when log scale is enabled

### ⚡ Performance

* **agent:** load the floating agent's chunk on first open

### ♻️ Refactoring

* **menu:** move Traffic under the Insights group
`

describe('classifyReleaseHeading', () => {
  test('keeps product sections and drops recap/internal', () => {
    expect(classifyReleaseHeading('### ✨ Features')).toBe('keep')
    expect(classifyReleaseHeading('## 🐛 Bug Fixes')).toBe('keep')
    expect(classifyReleaseHeading('### Highlights')).toBe('keep')
    expect(classifyReleaseHeading('## ⚡ Performance')).toBe('keep')
    expect(classifyReleaseHeading('## 📊 Release recap')).toBe('drop')
    expect(classifyReleaseHeading('## 🐳 Docker image')).toBe('drop')
    expect(classifyReleaseHeading('## 🔁 Full changelog')).toBe('drop')
    expect(classifyReleaseHeading('### ♻️ Refactoring')).toBe('drop')
  })
})

describe('isProductReleaseTag', () => {
  test('accepts vX.Y.Z only', () => {
    expect(isProductReleaseTag('v0.3.3')).toBe(true)
    expect(isProductReleaseTag('chm-v0.1.1')).toBe(false)
    expect(isProductReleaseTag('helm-chmonitor-0.2.0')).toBe(false)
  })
})

describe('parseGithubReleaseNotes', () => {
  test('skips recap stats and renders Features after a recap-led body', () => {
    const html = mdToHtml(RECAP_BODY)
    expect(html).toContain('pinned favorites')
    expect(html).toContain("What's new dialog")
    expect(html).toContain('Compact settings rail')
    expect(html).not.toContain('50 commits')
    expect(html).not.toContain('Shoutout')
    expect(html).not.toContain('docker pull')
    expect(html).not.toContain('move Traffic')
  })

  test('collects screenshots from Highlights, not the recap dump', () => {
    expect(extractImages(RECAP_BODY)).toEqual([
      { src: 'https://example.com/overview.png', alt: 'Overview' },
    ])
  })

  test('caps bullets after filtering, not before', () => {
    const recapLead = `## 📊 Release recap
- 50 commits
- shoutout
- extra recap
- more recap
- still recap

### ✨ Features

* **one:** first product bullet
* **two:** second product bullet
`
    const parsed = parseGithubReleaseNotes(recapLead)
    expect(parsed.html).toContain('first product bullet')
    expect(parsed.html).toContain('second product bullet')
    expect(parsed.html).not.toContain('50 commits')
  })

  test('drops 0.2.x recap blockquote, shoutout, and Docker', () => {
    const body = `> In this exciting release of **chmonitor**, we’ve celebrated 3 agents over 13 days, resulting in a remarkable 63 commits and 62 pull requests. A special shoutout goes to @github-actions[bot].

## ✨ Features
- Introduce outage escalation and error spike alerts.

## 📊 Release recap
- 📦 **63 commits** across **62 pull requests**
- 🏆 Shoutout to **@github-actions[bot]**

## 🐳 Docker image

\`\`\`bash
docker pull ghcr.io/chmonitor/chmonitor:0.2.16
\`\`\`
`
    const parsed = parseGithubReleaseNotes(body)
    expect(parsed.html).toContain('outage escalation')
    expect(parsed.html).not.toContain('63 commits')
    expect(parsed.html).not.toContain('shoutout')
    expect(parsed.html).not.toContain('docker pull')
  })
})
