import type { FriendlyNote, ReleaseNote, ReleaseNoteScreenshot } from './types'

import { LANDING_ORIGIN } from './constants'
import { normalizeVersion, toProductTag } from './version'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function resolveWhatsNewAssetUrl(
  src: string,
  origin = LANDING_ORIGIN
): string {
  const trimmed = src.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${origin}${path}`
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^["'](.*)["']$/)
  return (match ? match[1] : trimmed).trim()
}

function parseScalar(value: string): string {
  return unquote(value.replace(/#.*$/, ''))
}

/**
 * Minimal YAML subset for What's new frontmatter: `key: value`, a
 * `screenshots` list of strings or `{ src, alt }` maps. Not a general parser.
 */
export function parseFriendlyFrontmatter(raw: string): {
  version?: string
  date?: string
  summary?: string
  screenshots: ReleaseNoteScreenshot[]
} {
  const screenshots: ReleaseNoteScreenshot[] = []
  let version: string | undefined
  let date: string | undefined
  let summary: string | undefined
  let inScreenshots = false
  let pending: { src?: string; alt?: string } | null = null

  const flushPending = () => {
    if (pending?.src) {
      screenshots.push({
        src: pending.src,
        alt: pending.alt ?? '',
      })
    }
    pending = null
  }

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ')
    if (!line.trim()) continue

    if (inScreenshots) {
      const mapItem = line.match(/^\s+-\s+src:\s*(.+)$/)
      if (mapItem) {
        flushPending()
        pending = { src: parseScalar(mapItem[1] ?? '') }
        continue
      }
      const altItem = line.match(/^\s+alt:\s*(.+)$/)
      if (altItem && pending) {
        pending.alt = parseScalar(altItem[1] ?? '')
        continue
      }
      const stringItem = line.match(/^\s+-\s+(.+)$/)
      if (stringItem) {
        flushPending()
        const src = parseScalar(stringItem[1] ?? '')
        if (src) screenshots.push({ src, alt: '' })
        continue
      }
      if (/^\S/.test(line)) {
        flushPending()
        inScreenshots = false
      } else {
        continue
      }
    }

    if (/^screenshots:\s*$/.test(line.trimEnd())) {
      inScreenshots = true
      continue
    }

    const keyed = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
    if (!keyed) continue
    const key = keyed[1]
    const value = parseScalar(keyed[2] ?? '')
    if (key === 'version') version = value
    else if (key === 'date') date = value
    else if (key === 'summary') summary = value
  }
  flushPending()

  return { version, date, summary, screenshots }
}

function parseBullets(body: string): string[] {
  const bullets: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/)
    if (match) bullets.push(match[1]!.trim())
  }
  return bullets
}

export function parseFriendlyNoteMarkdown(
  markdown: string,
  fileHint?: string
): FriendlyNote | null {
  const match = markdown.replace(/\r\n/g, '\n').match(FRONTMATTER_RE)
  if (!match) return null
  const parsed = parseFriendlyFrontmatter(match[1] ?? '')
  const versionRaw = parsed.version?.trim()
  if (!versionRaw) return null
  const version = normalizeVersion(versionRaw)
  if (fileHint) {
    const hinted = normalizeVersion(fileHint.replace(/\.md$/i, ''))
    if (hinted && hinted !== version) return null
  }
  const body = (match[2] ?? '').trim()
  const summary = parsed.summary?.trim() ?? ''
  const bullets = parseBullets(body)
  if (!summary && bullets.length === 0) return null
  const date = parsed.date?.trim() || null
  return {
    version,
    date,
    summary,
    bullets,
    screenshots: parsed.screenshots.filter((shot) => shot.src),
  }
}

export function friendlyNoteToMarkdown(
  note: FriendlyNote,
  options?: { absoluteScreenshots?: boolean; origin?: string }
): string {
  const parts: string[] = []
  if (note.summary) parts.push(note.summary)
  if (note.bullets.length > 0) {
    parts.push(note.bullets.map((bullet) => `- ${bullet}`).join('\n'))
  }
  if (note.screenshots.length > 0) {
    const origin = options?.origin
    const absolute = options?.absoluteScreenshots !== false
    parts.push(
      note.screenshots
        .map((shot) => {
          const src =
            absolute && origin
              ? resolveWhatsNewAssetUrl(shot.src, origin)
              : shot.src
          const alt = shot.alt || 'Release screenshot'
          return `![${alt}](${src})`
        })
        .join('\n')
    )
  }
  return parts.join('\n\n').trim()
}

export function serializeFriendlyNoteMarkdown(note: FriendlyNote): string {
  const lines = [
    '---',
    `version: ${note.version}`,
    ...(note.date ? [`date: ${note.date}`] : []),
    `summary: ${note.summary}`,
  ]
  if (note.screenshots.length > 0) {
    lines.push('screenshots:')
    for (const shot of note.screenshots) {
      if (shot.alt) {
        lines.push(`  - src: ${shot.src}`, `    alt: ${shot.alt}`)
      } else {
        lines.push(`  - ${shot.src}`)
      }
    }
  }
  lines.push('---', '')
  for (const bullet of note.bullets) {
    lines.push(`- ${bullet}`)
  }
  lines.push('')
  return lines.join('\n')
}

function parseFriendlyDate(date: string | null): string | null {
  if (!date) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00.000Z`
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function friendlyNoteToReleaseNote(
  note: FriendlyNote,
  options?: { publishedAt?: string | null; origin?: string }
): ReleaseNote {
  const origin = options?.origin ?? LANDING_ORIGIN
  const screenshots = note.screenshots.map((shot) => ({
    src: resolveWhatsNewAssetUrl(shot.src, origin),
    alt: shot.alt || 'Release screenshot',
  }))
  return {
    version: note.version,
    tag: toProductTag(note.version),
    publishedAt: options?.publishedAt ?? parseFriendlyDate(note.date),
    summary: note.summary,
    markdown: friendlyNoteToMarkdown(
      { ...note, screenshots },
      { absoluteScreenshots: false }
    ),
    highlights: note.bullets,
    kind: 'friendly',
    screenshots,
  }
}

export function indexFriendlyNotes(
  notes: readonly FriendlyNote[]
): Map<string, FriendlyNote> {
  const map = new Map<string, FriendlyNote>()
  for (const note of notes) {
    map.set(note.version, note)
    map.set(toProductTag(note.version), note)
  }
  return map
}

/**
 * Prefer a per-version friendly file over a stripped GitHub / CHANGELOG body.
 */
export function overlayFriendlyNotes(
  notes: readonly ReleaseNote[],
  friendly: readonly FriendlyNote[]
): ReleaseNote[] {
  if (friendly.length === 0) return [...notes]
  const map = indexFriendlyNotes(friendly)
  return notes.map((note) => {
    const match = map.get(note.version) ?? map.get(note.tag)
    if (!match) return note
    return friendlyNoteToReleaseNote(match, {
      publishedAt: note.publishedAt ?? parseFriendlyDate(match.date),
    })
  })
}

export function parseFriendlyNotesJson(raw: unknown): FriendlyNote[] {
  if (!raw || typeof raw !== 'object') return []
  const notes = (raw as { notes?: unknown }).notes
  if (!Array.isArray(notes)) return []
  const parsed: FriendlyNote[] = []
  for (const item of notes) {
    if (!item || typeof item !== 'object') continue
    const note = item as Partial<FriendlyNote>
    if (typeof note.version !== 'string' || typeof note.summary !== 'string') {
      continue
    }
    if (!Array.isArray(note.bullets)) continue
    parsed.push({
      version: normalizeVersion(note.version),
      date: typeof note.date === 'string' ? note.date : null,
      summary: note.summary,
      bullets: note.bullets.filter(
        (bullet): bullet is string => typeof bullet === 'string'
      ),
      screenshots: Array.isArray(note.screenshots)
        ? note.screenshots.filter((shot): shot is ReleaseNoteScreenshot =>
            Boolean(
              shot &&
                typeof shot === 'object' &&
                typeof (shot as ReleaseNoteScreenshot).src === 'string'
            )
          )
        : [],
    })
  }
  return parsed
}

export function serializeFriendlyNotesJson(
  notes: readonly FriendlyNote[]
): string {
  return `${JSON.stringify({ notes }, null, 2)}\n`
}
