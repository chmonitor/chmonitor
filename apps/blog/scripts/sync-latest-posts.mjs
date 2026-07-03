#!/usr/bin/env node
// Regenerates apps/landing/src/data/latest-posts.json from the blog's own
// content collection, so the landing footer's "Latest from the blog" widget
// stays in sync without landing needing a cross-app build-time fetch.
//
// apps/blog and apps/landing are independent Astro apps built and deployed
// separately (see .github/workflows/blog.yml / landing.yml) — landing's CI
// job never checks out a built blog, and a build-time network fetch to
// blog.chmonitor.dev would make landing's build depend on a live external
// service. A committed JSON snapshot avoids both problems: run this after
// publishing a post and commit the snapshot alongside it.
//
// Usage: cd apps/blog && node scripts/sync-latest-posts.mjs [--limit N]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BLOG_DIR = join(__dirname, '..', 'src', 'content', 'blog')
const OUT_PATH = join(__dirname, '..', '..', 'landing', 'src', 'data', 'latest-posts.json')
const DEFAULT_LIMIT = 5

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    let [, key, value] = m
    value = value.trim().replace(/^"(.*)"$/, '$1')
    fm[key] = value
  }
  return fm
}

function main() {
  const limitFlagIndex = process.argv.indexOf('--limit')
  const limit =
    limitFlagIndex >= 0 ? Number(process.argv[limitFlagIndex + 1]) : DEFAULT_LIMIT

  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'))
  const posts = files
    .map((file) => {
      const raw = readFileSync(join(BLOG_DIR, file), 'utf8')
      const fm = parseFrontmatter(raw)
      if (!fm || fm.draft === 'true') return null
      const slug = fm.version ?? file.replace(/\.md$/, '')
      return {
        title: fm.title,
        date: fm.date,
        tag: fm.tag ?? 'Release',
        url: `https://blog.chmonitor.dev/${slug}/`,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf())
    .slice(0, limit)

  writeFileSync(OUT_PATH, `${JSON.stringify(posts, null, 2)}\n`)
  console.log(`Wrote ${posts.length} posts to ${OUT_PATH}`)
}

main()
