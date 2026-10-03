import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Release posts live at /vX.Y.Z/: the slug comes from `version` (see slug.ts).
// Two posts with the same version build to the same URL and one silently
// replaces the other — that happened with v0.3.6 — so every release post needs
// a version, and versions must be unique across the blog.
const BLOG_DIR = join(import.meta.dir, '../content/blog')
const VERSION_RE = /^v\d+\.\d+(\.\d+)?$/

function frontmatter(file: string): Record<string, string> {
  const raw = readFileSync(join(BLOG_DIR, file), 'utf8')
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const data: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (m) data[m[1]!] = m[2]!.replace(/^["']|["']$/g, '').trim()
  }
  return data
}

const posts = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((file) => ({ file, data: frontmatter(file) }))

describe('release posts', () => {
  test('every Release post has a vX.Y[.Z] version, so it lives at /vX.Y.Z/', () => {
    const bad = posts
      .filter((p) => (p.data.tag ?? 'Release') === 'Release')
      .filter((p) => !VERSION_RE.test(p.data.version ?? ''))
      .map((p) => `${p.file}: version=${p.data.version ?? '(missing)'}`)
    expect(bad).toEqual([])
  })

  test('no two posts share a version (same version = same URL)', () => {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const p of posts) {
      const v = p.data.version
      if (!v) continue
      const other = seen.get(v)
      if (other) dupes.push(`${v}: ${other} and ${p.file}`)
      else seen.set(v, p.file)
    }
    expect(dupes).toEqual([])
  })

  test('the title names the same version as the frontmatter', () => {
    const bad = posts
      .filter((p) => p.data.version && /\bv\d+\.\d+/.test(p.data.title ?? ''))
      .filter(
        (p) =>
          !(p.data.title ?? '').includes(`${p.data.version} `) &&
          !(p.data.title ?? '').endsWith(p.data.version!)
      )
      .map(
        (p) => `${p.file}: title="${p.data.title}" version=${p.data.version}`
      )
    expect(bad).toEqual([])
  })
})
