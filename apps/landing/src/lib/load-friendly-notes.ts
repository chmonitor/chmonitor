import type { FriendlyNote } from '../../../dashboard/src/lib/whats-new/types'

import { loadFriendlyNotesFromDir } from '../../../dashboard/src/lib/whats-new/load-friendly-notes'
import { indexFriendlyNotes } from '../../../dashboard/src/lib/whats-new/parse-friendly-note'
import {
  formatInline,
  type ReleaseNoteImage,
} from './parse-github-release-notes'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
