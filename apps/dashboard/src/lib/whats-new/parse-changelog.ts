import type { ReleaseNote } from './types'

import { AIRGAP_SNAPSHOT_LIMIT } from './constants'
import { buildReleaseNote, stripToProductNotes } from './parse-release-body'
import { isProductVersionTag, parseSemver, toProductTag } from './version'

const SECTION_RE = /^## \[([^\]]+)\](?:\([^)]+\))?(?:\s+\(([^)]+)\))?[ \t]*$/gm

function parseChangelogDate(raw: string | undefined): string | null {
  if (!raw) return null
  const isoDay = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  if (!isoDay) return null
  return `${isoDay[1]}T00:00:00.000Z`
}

/**
 * Parse `## [x.y.z]` / `## [Unreleased]` sections from CHANGELOG.md.
 * Product versions only; Unreleased is kept when it has Highlights.
 */
export function parseChangelogMarkdown(markdown: string): ReleaseNote[] {
  const text = markdown.replace(/\r\n/g, '\n')
  const matches = [...text.matchAll(SECTION_RE)]
  const notes: ReleaseNote[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!
    const heading = match[1]!.trim()
    const dateLabel = match[2]
    const start = (match.index ?? 0) + match[0].length
    const end =
      i + 1 < matches.length
        ? (matches[i + 1]!.index ?? text.length)
        : text.length
    const body = text.slice(start, end).trim()

    if (/^unreleased$/i.test(heading)) {
      const note = buildReleaseNote({
        version: 'unreleased',
        publishedAt: null,
        markdown: body,
      })
      note.version = 'unreleased'
      note.tag = 'Unreleased'
      if (note.highlights.length === 0 && !note.markdown.trim()) continue
      notes.push(note)
      continue
    }

    const tag = heading.startsWith('v') ? heading : toProductTag(heading)
    if (!isProductVersionTag(tag) && !parseSemver(heading)) continue
    if (!parseSemver(heading)) continue

    notes.push(
      buildReleaseNote({
        version: heading,
        publishedAt: parseChangelogDate(dateLabel),
        markdown: body,
      })
    )
  }

  return notes
}

/**
 * Small airgap payload: latest `vX.Y.Z` Features only (Fixes / Perf /
 * Highlights stay on the live GitHub body). Unreleased is omitted.
 */
export function buildAirgapSnapshot(
  changelogMarkdown: string,
  limit = AIRGAP_SNAPSHOT_LIMIT
): ReleaseNote[] {
  return parseChangelogMarkdown(changelogMarkdown)
    .filter(
      (note) => note.version !== 'unreleased' && isProductVersionTag(note.tag)
    )
    .map((note) => {
      const features = stripToProductNotes(note.markdown, ['features'])
      return {
        ...note,
        markdown: features.markdown,
        summary: features.summary,
        highlights: features.highlights,
      }
    })
    .filter((note) => note.markdown.trim().length > 0)
    .slice(0, limit)
}
