import { BLOG_ORIGIN, getLatestBlogPost } from './latest-blog-post'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function tmpDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'chm-latest-blog-'))
  return dir
}

function writePost(name: string, frontmatter: string): void {
  writeFileSync(join(dir, name), `---\n${frontmatter}\n---\nbody\n`)
}

describe('getLatestBlogPost', () => {
  test('returns a real published post from the blog content dir', () => {
    const latest = getLatestBlogPost()
    expect(latest).not.toBeNull()
    expect(latest!.title.length).toBeGreaterThan(0)
    expect(latest!.description.length).toBeGreaterThan(0)
    expect(latest!.href.startsWith(`${BLOG_ORIGIN}/`)).toBe(true)
    expect(latest!.href.endsWith('/')).toBe(true)
    expect(latest!.slug.length).toBeGreaterThan(0)
    expect(latest!.date.valueOf()).toBeLessThanOrEqual(Date.now())
  })

  test('sorts by date and picks the newest published post', () => {
    tmpDir()
    writePost('old.md', 'title: "Old post"\ndescription: "d"\ndate: 2026-01-01')
    writePost('mid.md', 'title: "Mid post"\ndescription: "d"\ndate: 2026-06-01')
    writePost(
      'new.md',
      'title: "Newest post"\ndescription: "fresh"\ndate: 2026-08-01'
    )
    const latest = getLatestBlogPost({
      dir,
      now: new Date('2026-08-20T12:00:00Z'),
    })
    expect(latest?.title).toBe('Newest post')
    expect(latest?.slug).toBe('new')
    expect(latest?.href).toBe(`${BLOG_ORIGIN}/new/`)
    expect(latest?.description).toBe('fresh')
  })

  test('excludes drafts even when they are the newest', () => {
    tmpDir()
    writePost('live.md', 'title: "Live"\ndescription: "d"\ndate: 2026-08-01')
    writePost(
      'draft.md',
      'title: "Draft"\ndescription: "d"\ndate: 2026-08-19\ndraft: true'
    )
    const latest = getLatestBlogPost({
      dir,
      now: new Date('2026-08-20T12:00:00Z'),
    })
    expect(latest?.title).toBe('Live')
    expect(latest?.slug).toBe('live')
  })

  test('treats a YYYY-MM-DD date as that local calendar day', () => {
    tmpDir()
    writePost('today.md', 'title: "Today"\ndescription: "d"\ndate: 2026-08-20')
    writePost(
      'yesterday.md',
      'title: "Yesterday"\ndescription: "d"\ndate: 2026-08-19'
    )
    const latest = getLatestBlogPost({
      dir,
      now: new Date(2026, 7, 20, 0, 20),
    })
    expect(latest?.title).toBe('Today')
    expect(latest?.slug).toBe('today')
  })

  test('excludes future-dated posts (#2697)', () => {
    tmpDir()
    writePost('live.md', 'title: "Live"\ndescription: "d"\ndate: 2026-08-01')
    writePost(
      'scheduled.md',
      'title: "Scheduled"\ndescription: "d"\ndate: 2026-12-01'
    )
    const latest = getLatestBlogPost({
      dir,
      now: new Date('2026-08-20T12:00:00Z'),
    })
    expect(latest?.title).toBe('Live')
    expect(latest?.slug).toBe('live')
  })

  test('uses version as the public slug when set', () => {
    tmpDir()
    writePost(
      'chmonitor-v0-3.md',
      'title: "chmonitor v0.3"\ndescription: "rebuild"\ndate: 2026-06-29\nversion: v0.3'
    )
    const latest = getLatestBlogPost({
      dir,
      now: new Date('2026-08-20T12:00:00Z'),
    })
    expect(latest?.slug).toBe('v0.3')
    expect(latest?.href).toBe(`${BLOG_ORIGIN}/v0.3/`)
  })

  test('landing deploy filter includes blog markdown so the hero pill stays current', () => {
    const yml = readFileSync(
      join(import.meta.dir, '../../../../.github/workflows/cloudflare.yml'),
      'utf8'
    )
    const landingPaths = yml.indexOf("- 'apps/landing/**'")
    expect(landingPaths).toBeGreaterThan(-1)
    expect(yml.slice(landingPaths, landingPaths + 500)).toContain(
      'apps/blog/src/content/blog/**'
    )
  })

  test('returns null when the directory has no published posts', () => {
    tmpDir()
    writePost('soon.md', 'title: "Soon"\ndescription: "d"\ndate: 2099-01-01')
    expect(
      getLatestBlogPost({ dir, now: new Date('2026-08-20T12:00:00Z') })
    ).toBeNull()
  })
})
