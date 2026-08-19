import type { FriendlyNote } from './types'

import { parseFriendlyNoteMarkdown } from './parse-friendly-note'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE_RE = /^v\d+\.\d+\.\d+\.md$/

function defaultSearchDirs(fromDir: string): string[] {
  return [
    join(fromDir, '../../../docs/whats-new'),
    join(fromDir, '../../../../docs/whats-new'),
    join(fromDir, '../../../../../docs/whats-new'),
    join(process.cwd(), 'docs/whats-new'),
    join(process.cwd(), '../../docs/whats-new'),
  ]
}

export function resolveWhatsNewDir(
  fromDir = dirname(fileURLToPath(import.meta.url))
): string | null {
  for (const dir of defaultSearchDirs(fromDir)) {
    if (existsSync(dir)) return dir
  }
  return null
}

/**
 * Node-only loader for `docs/whats-new/vX.Y.Z.md`. Not imported by the
 * Worker `fetch-releases` module (no filesystem there).
 */
export function loadFriendlyNotesFromDir(dir?: string): FriendlyNote[] {
  const resolved = dir ?? resolveWhatsNewDir()
  if (!resolved || !existsSync(resolved)) return []

  const notes: FriendlyNote[] = []
  for (const name of readdirSync(resolved).sort().reverse()) {
    if (!FILE_RE.test(name)) continue
    const markdown = readFileSync(join(resolved, name), 'utf8')
    const parsed = parseFriendlyNoteMarkdown(markdown, name)
    if (parsed) notes.push(parsed)
  }
  return notes
}
