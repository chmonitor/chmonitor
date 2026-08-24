import {
  draftFriendlyNote,
  extractUnreleasedHighlights,
  pickFriendlyNoteMarkdown,
  stripNoise,
} from './draft-friendly-note'
import friendlyNotesJson from './friendly-notes.json'
import { loadFriendlyNotesFromDir } from './load-friendly-notes'
import {
  friendlyNoteToReleaseNote,
  overlayFriendlyNotes,
  parseFriendlyNoteMarkdown,
  parseFriendlyNotesJson,
} from './parse-friendly-note'
import {
  buildReleaseNote,
  isRecapLikeText,
  stripToProductNotes,
} from './parse-release-body'
import { describe, expect, test } from 'bun:test'

const FRIENDLY_V033 = `---
version: 0.3.3
date: 2026-08-16
summary: Guest AI caps, simpler alerts, and pinned favorites you can drag.
screenshots:
  - src: /assets/whats-new/v0.3.3-nav.png
    alt: Favorites
---

- Cap and track guest AI usage on Cloud.
- Drag to reorder pinned favorites.
`

const RECAP_DUMP_033 = `## 📊 Release recap

- 📦 **50 commits** across **50 pull requests**
- 🏆 Shoutout to **@github-actions[bot]**

## 🐳 Docker image

\`\`\`bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.3
\`\`\`

### ✨ Features

* **nav:** drag to reorder pinned favorites ([#3026](https://example/3026)) (f5c5fb1)
* **ui:** add settings icon
`

const V0216_BODY = `> In this exciting release of **chmonitor**, we’ve celebrated the contributions of 3 dedicated agents over 13 days, resulting in a remarkable 63 commits and 62 pull requests — averaging nearly 5 changes per day! Our night owls made 37 commits under the stars while our daytime contributors added 26. A special shoutout goes to @github-actions[bot], who kept the momentum going with 37 insightful comments.

## ✨ Features
- Introduce outage escalation and error spike alerts for improved incident response.
- Add DAU/MAU tracking and weekly report generation to enhance user engagement analysis.

## 📊 Release recap

- 📦 **63 commits** across **62 pull requests**
- 🏆 Shoutout to **@github-actions[bot]**

## 🐳 Docker image

\`\`\`bash
docker pull ghcr.io/chmonitor/chmonitor:0.2.16
\`\`\`
`

describe('parseFriendlyNoteMarkdown', () => {
  test('reads version, summary, bullets, and screenshots', () => {
    const note = parseFriendlyNoteMarkdown(FRIENDLY_V033, 'v0.3.3.md')
    expect(note?.version).toBe('0.3.3')
    expect(note?.summary).toContain('Guest AI caps')
    expect(note?.bullets).toHaveLength(2)
    expect(note?.screenshots[0]?.src).toBe('/assets/whats-new/v0.3.3-nav.png')
  })

  test('rejects a file whose name does not match version', () => {
    expect(parseFriendlyNoteMarkdown(FRIENDLY_V033, 'v0.3.2.md')).toBeNull()
  })
})

describe('overlayFriendlyNotes', () => {
  test('friendly notes win over a recap dump', () => {
    const stripped = buildReleaseNote({
      version: '0.3.3',
      publishedAt: '2026-08-16T12:00:00Z',
      markdown: RECAP_DUMP_033,
    })
    expect(stripped.markdown).toContain('Features')
    const friendly = parseFriendlyNoteMarkdown(FRIENDLY_V033)
    expect(friendly).not.toBeNull()
    const [overlaid] = overlayFriendlyNotes([stripped], [friendly!])
    expect(overlaid?.kind).toBe('friendly')
    expect(overlaid?.summary).toBe(
      'Guest AI caps, simpler alerts, and pinned favorites you can drag.'
    )
    expect(overlaid?.markdown).toContain('Cap and track guest AI usage')
    expect(overlaid?.markdown).not.toContain('50 commits')
    expect(overlaid?.markdown).not.toContain('Shoutout')
    expect(overlaid?.markdown).not.toContain('docker pull')
    expect(overlaid?.markdown).not.toContain('f5c5fb1')
    expect(overlaid?.screenshots?.[0]?.src).toContain(
      '/assets/whats-new/v0.3.3-nav.png'
    )
  })

  test('versions without a file keep the stripped Features fallback', () => {
    const stripped = buildReleaseNote({
      version: '0.2.16',
      markdown: V0216_BODY,
    })
    const friendly = parseFriendlyNoteMarkdown(FRIENDLY_V033)!
    const [overlaid] = overlayFriendlyNotes([stripped], [friendly])
    expect(overlaid?.kind).toBe('stripped')
    expect(overlaid?.markdown).toContain('outage escalation')
    expect(overlaid?.markdown).not.toContain('63 commits')
  })
})

describe('isRecapLikeText + 0.2.x preface', () => {
  test('detects recap shoutout copy', () => {
    expect(
      isRecapLikeText(
        '63 commits and 62 pull requests. A special shoutout goes to @github-actions[bot]'
      )
    ).toBe(true)
    expect(
      isRecapLikeText('Compact settings rail and a faster agent widget.')
    ).toBe(false)
  })

  test('stripToProductNotes drops 0.2.x recap blockquote and Docker', () => {
    const result = stripToProductNotes(V0216_BODY)
    expect(result.markdown).toContain('outage escalation')
    expect(result.markdown).toContain('Features')
    expect(result.markdown).not.toContain('63 commits')
    expect(result.markdown).not.toContain('Shoutout')
    expect(result.markdown).not.toContain('docker pull')
    expect(result.summary).not.toContain('63 commits')
  })
})

describe('docs/whats-new catalog', () => {
  test('seeded 0.3.x files parse as friendly notes', () => {
    const notes = loadFriendlyNotesFromDir()
    const versions = notes.map((note) => note.version).sort()
    expect(versions).toEqual(['0.3.0', '0.3.1', '0.3.2', '0.3.3', '0.3.4'])
    for (const note of notes) {
      expect(note.summary.length).toBeGreaterThan(10)
      expect(note.bullets.length).toBeGreaterThanOrEqual(4)
      expect(note.bullets.length).toBeLessThanOrEqual(8)
      const blob = `${note.summary}\n${note.bullets.join('\n')}`
      expect(blob).not.toMatch(/shoutout/i)
      expect(blob).not.toMatch(/docker pull/i)
      expect(blob).not.toMatch(/\(#\d+\)/)
    }
  })

  test('bundled friendly-notes.json matches docs/whats-new', () => {
    const fromDisk = loadFriendlyNotesFromDir()
      .map((note) => note.version)
      .sort()
    const bundled = parseFriendlyNotesJson(friendlyNotesJson)
      .map((note) => note.version)
      .sort()
    expect(bundled).toEqual(fromDisk)
  })
})

describe('draftFriendlyNote', () => {
  test('rewrites Features into friendly copy and copies Unreleased Highlights', () => {
    const changelog = `## [Unreleased]

### Highlights

- Upcoming guest AI caps
- ![Nav](/assets/whats-new/v0.3.3-nav.png)

## [0.3.3](https://example) (2026-08-15)
`
    const note = draftFriendlyNote({
      version: '0.3.3',
      date: '2026-08-16',
      releaseBody: RECAP_DUMP_033,
      changelogMarkdown: changelog,
    })
    expect(note.version).toBe('0.3.3')
    expect(note.bullets[0]).toContain('Upcoming guest AI caps')
    expect(note.bullets.some((b) => /pinned favorites/i.test(b))).toBe(true)
    expect(note.screenshots[0]?.src).toBe('/assets/whats-new/v0.3.3-nav.png')
    expect(note.summary).not.toMatch(/50 commits/)
  })

  test('pickFriendlyNoteMarkdown rejects recap-tainted AI output', () => {
    const good = parseFriendlyNoteMarkdown(FRIENDLY_V033)!
    const deterministic = `---
version: 0.3.3
date: 2026-08-16
summary: Deterministic summary.
---

- Deterministic bullet.
`
    const dirty = `---
version: 0.3.3
date: 2026-08-16
summary: 50 commits and a shoutout.
---

- docker pull ghcr.io/chmonitor/chmonitor:0.3.3
`
    expect(pickFriendlyNoteMarkdown(deterministic, dirty, '0.3.3')).toBe(
      deterministic
    )
    expect(
      pickFriendlyNoteMarkdown(deterministic, FRIENDLY_V033, '0.3.3')
    ).toContain(good.summary)
  })

  test('stripNoise drops SHAs, PRs, and scope prefixes', () => {
    expect(
      stripNoise(
        '**nav:** drag to reorder pinned favorites ([#3026](https://example/3026)) (f5c5fb1)'
      )
    ).toBe('drag to reorder pinned favorites')
  })

  test('extractUnreleasedHighlights reads bullets and images', () => {
    const extracted = extractUnreleasedHighlights(`## [Unreleased]

### Highlights

- One
- ![Shot](/assets/screenshots/overview-dark-with-bg.jpeg)

### ✨ Features

* **ui:** ignored
`)
    expect(extracted.bullets).toEqual(['One'])
    expect(extracted.screenshots[0]?.src).toContain(
      'overview-dark-with-bg.jpeg'
    )
  })
})

describe('friendlyNoteToReleaseNote', () => {
  test('rewrites /assets paths to the landing origin', () => {
    const note = parseFriendlyNoteMarkdown(FRIENDLY_V033)!
    const release = friendlyNoteToReleaseNote(note)
    expect(release.screenshots?.[0]?.src).toBe(
      'https://chmonitor.dev/assets/whats-new/v0.3.3-nav.png'
    )
  })
})
