import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveChangelogPath(): string {
  const candidates = [
    join(process.cwd(), '../../CHANGELOG.md'),
    fileURLToPath(new URL('../../../../CHANGELOG.md', import.meta.url)),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error('CHANGELOG.md not found')
}

export function readChangelogMarkdown(): string {
  return readFileSync(resolveChangelogPath(), 'utf8')
}
