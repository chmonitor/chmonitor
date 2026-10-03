import { BLOG_ORIGIN } from '../seo-routing'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Maps a release version (`v0.3.6`) to its public blog post URL. Mirrors the
 * blog's own publish rules (`apps/blog/src/lib/published.ts`: not `draft`, date
 * not in the future) so the changelog never links to a 404. Read from disk —
 * do not import apps/blog (depcruise `no-cross-app-imports`).
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

function unquote(value: string): string {
  return value
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim()
}

function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
    if (match) fields[match[1]!] = unquote(match[2] ?? '')
  }
  return fields
}

export function releaseVersionFromPost(
  markdown: string,
  now: number = Date.now()
): string | null {
  const match = markdown.match(FRONTMATTER_RE)
  if (!match) return null
  const fields = parseFields(match[1] ?? '')
  if (fields.tag !== 'Release' || !fields.version) return null
  if (fields.draft === 'true') return null
  const date = new Date(fields.date ?? '')
  if (Number.isNaN(date.valueOf()) || date.valueOf() > now) return null
  return fields.version
}

export function loadBlogReleasePostsFromDir(
  dir: string,
  now: number = Date.now()
): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(dir)) return map
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const version = releaseVersionFromPost(
      readFileSync(join(dir, name), 'utf8'),
      now
    )
    if (!version) continue
    const url = `${BLOG_ORIGIN}/${version}/`
    const bare = version.replace(/^v/i, '')
    // A minor post ("v0.3") is the release tagged "v0.3.0".
    const keys = /^\d+\.\d+$/.test(bare) ? [bare, `${bare}.0`] : [bare]
    for (const key of keys) {
      if (!map.has(key)) map.set(key, url)
      if (!map.has(`v${key}`)) map.set(`v${key}`, url)
    }
  }
  return map
}

function resolveBlogDir(): string | null {
  const candidates = [
    join(process.cwd(), '../blog/src/content/blog'),
    fileURLToPath(new URL('../../../blog/src/content/blog', import.meta.url)),
  ]
  return candidates.find((dir) => existsSync(dir)) ?? null
}

let cached: Map<string, string> | null = null

export function loadBlogReleasePosts(): Map<string, string> {
  if (cached) return cached
  const dir = resolveBlogDir()
  cached = dir ? loadBlogReleasePostsFromDir(dir) : new Map()
  return cached
}
