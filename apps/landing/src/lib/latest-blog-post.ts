import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Public origin for blog posts linked from the landing page. */
export const BLOG_ORIGIN = 'https://blog.chmonitor.dev'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

export type LatestBlogPost = {
  title: string
  description: string
  date: Date
  slug: string
  href: string
}

export type LatestBlogPostOptions = {
  /** Override the blog content directory (tests). */
  dir?: string
  /** Override "now" so draft/future filtering is deterministic (tests). */
  now?: Date
}

/**
 * Newest published post in `apps/blog/src/content/blog/*.md`.
 *
 * Published = not `draft` and `date <= now`, matching the blog app's
 * `isPublished` / `postSlug` (version frontmatter wins over filename id).
 * Parses YAML frontmatter locally — do not import `astro:content` from blog.
 *
 * This is build-time. The Cloudflare landing job must rebuild when blog
 * markdown changes (see `.github/workflows/cloudflare.yml` landing filter).
 */
export function getLatestBlogPost(
  options: LatestBlogPostOptions = {}
): LatestBlogPost | null {
  const dir = options.dir ?? resolveBlogContentDir()
  if (!dir) return null
  const now = options.now?.valueOf() ?? Date.now()

  let latest: LatestBlogPost | null = null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const parsed = parseBlogPostFile(join(dir, name), name)
    if (!parsed) continue
    if (!isPublished(parsed, now)) continue
    if (!latest || parsed.date.valueOf() > latest.date.valueOf()) {
      latest = {
        title: parsed.title,
        description: parsed.description,
        date: parsed.date,
        slug: parsed.slug,
        href: parsed.href,
      }
    }
  }
  return latest
}

export function resolveBlogContentDir(): string | null {
  const candidates = [
    fileURLToPath(new URL('../../../blog/src/content/blog', import.meta.url)),
    join(process.cwd(), '../blog/src/content/blog'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

function isPublished(
  post: Pick<LatestBlogPost, 'date'> & { draft: boolean },
  now: number
): boolean {
  return !post.draft && post.date.valueOf() <= now
}

function parseBlogPostFile(
  path: string,
  filename: string
): (LatestBlogPost & { draft: boolean }) | null {
  const raw = readFileSync(path, 'utf8')
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return null

  const fields = parseFrontmatter(match[1] ?? '')
  const title = fields.title
  const description = fields.description ?? ''
  const date = parseDate(fields.date)
  if (!title || !date) return null

  const id = filename.replace(/\.md$/i, '')
  const slug = fields.version || id
  return {
    title,
    description,
    date,
    slug,
    href: `${BLOG_ORIGIN}/${slug}/`,
    draft: fields.draft === 'true',
  }
}

function parseFrontmatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const keyed = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
    if (!keyed) continue
    fields[keyed[1]!] = unquote(keyed[2] ?? '')
  }
  return fields
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^["'](.*)["']$/)
  return (match ? match[1] : trimmed).trim()
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  // Date-only YAML (`2026-08-20`) is that local calendar day, not UTC midnight.
  const day = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) {
    const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    return Number.isNaN(date.valueOf()) ? null : date
  }
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date
}
