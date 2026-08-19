import {
  formatInline,
  type ReleaseNoteImage,
} from './parse-github-release-notes'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Landing-local copy of the dashboard friendly-note shape. The shared source
 * is `docs/whats-new/vX.Y.Z.md` — do not import apps/dashboard (depcruise
 * `no-cross-app-imports`).
 */
export type FriendlyNote = {
  version: string
  date: string | null
  summary: string
  bullets: string[]
  screenshots: { src: string; alt: string }[]
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const FILE_RE = /^v\d+\.\d+\.\d+\.md$/

export function stripVersionPrefix(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^["'](.*)["']$/)
  return (match ? match[1] : trimmed).trim()
}

function parseScalar(value: string): string {
  return unquote(value.replace(/#.*$/, ''))
}

function parseFrontmatter(raw: string): {
  version?: string
  date?: string
  summary?: string
  screenshots: FriendlyNote['screenshots']
} {
  const screenshots: FriendlyNote['screenshots'] = []
  let version: string | undefined
  let date: string | undefined
  let summary: string | undefined
  let inScreenshots = false
  let pending: { src?: string; alt?: string } | null = null

  const flushPending = () => {
    if (pending?.src) {
      screenshots.push({ src: pending.src, alt: pending.alt ?? '' })
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

export function parseFriendlyNoteMarkdown(
  markdown: string,
  fileHint?: string
): FriendlyNote | null {
  const match = markdown.replace(/\r\n/g, '\n').match(FRONTMATTER_RE)
  if (!match) return null
  const parsed = parseFrontmatter(match[1] ?? '')
  const versionRaw = parsed.version?.trim()
  if (!versionRaw) return null
  const version = stripVersionPrefix(versionRaw)
  if (fileHint) {
    const hinted = stripVersionPrefix(fileHint.replace(/\.md$/i, ''))
    if (hinted && hinted !== version) return null
  }
  const body = (match[2] ?? '').trim()
  const summary = parsed.summary?.trim() ?? ''
  const bullets: string[] = []
  for (const line of body.split('\n')) {
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) bullets.push(bullet[1]!.trim())
  }
  if (!summary && bullets.length === 0) return null
  return {
    version,
    date: parsed.date?.trim() || null,
    summary,
    bullets,
    screenshots: parsed.screenshots.filter((shot) => shot.src),
  }
}

function resolveWhatsNewDir(): string | null {
  const candidates = [
    join(process.cwd(), '../../docs/whats-new'),
    fileURLToPath(new URL('../../../../docs/whats-new', import.meta.url)),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

function loadFriendlyNotesFromDir(dir: string): FriendlyNote[] {
  const notes: FriendlyNote[] = []
  for (const name of readdirSync(dir).sort().reverse()) {
    if (!FILE_RE.test(name)) continue
    const parsed = parseFriendlyNoteMarkdown(
      readFileSync(join(dir, name), 'utf8'),
      name
    )
    if (parsed) notes.push(parsed)
  }
  return notes
}

function indexFriendlyNotes(
  notes: readonly FriendlyNote[]
): Map<string, FriendlyNote> {
  const map = new Map<string, FriendlyNote>()
  for (const note of notes) {
    map.set(note.version, note)
    map.set(`v${note.version}`, note)
  }
  return map
}

let cached: Map<string, FriendlyNote> | null = null

export function loadLandingFriendlyNotes(): Map<string, FriendlyNote> {
  if (cached) return cached
  const dir = resolveWhatsNewDir()
  cached = dir ? indexFriendlyNotes(loadFriendlyNotesFromDir(dir)) : new Map()
  return cached
}

export function friendlyNoteToHtml(note: FriendlyNote): string {
  const parts: string[] = []
  if (note.summary) parts.push(`<p>${formatInline(note.summary)}</p>`)
  if (note.bullets.length > 0) {
    const items = note.bullets
      .map((bullet) => `<li>${formatInline(bullet)}</li>`)
      .join('')
    parts.push(`<ul>${items}</ul>`)
  }
  return parts.join('')
}

export function friendlyNoteImages(note: FriendlyNote): ReleaseNoteImage[] {
  return note.screenshots.map((shot) => ({
    src: shot.src,
    alt: shot.alt || 'Release screenshot',
  }))
}
