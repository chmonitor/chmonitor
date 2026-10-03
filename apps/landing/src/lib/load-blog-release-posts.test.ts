import { loadBlogReleasePostsFromDir } from './load-blog-release-posts'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NOW = Date.parse('2026-10-03T12:00:00Z')
let dir: string

function post(name: string, fm: string) {
  writeFileSync(join(dir, name), `---\ntitle: "x"\n${fm}\n---\n\nbody\n`)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'blog-releases-'))
  post('ok.md', 'date: 2026-10-03\ntag: Release\nversion: v0.3.6')
  post('minor.md', 'date: 2026-06-29\ntag: Release\nversion: v0.3')
  post(
    'draft.md',
    'date: 2026-10-01\ntag: Release\nversion: v0.3.7\ndraft: true'
  )
  post('future.md', 'date: 2026-12-01\ntag: Release\nversion: v0.4.0')
  post('essay.md', 'date: 2026-09-01\ntag: Engineering\nversion: v0.3.5')
  post('nover.md', 'date: 2026-09-01\ntag: Release')
  writeFileSync(join(dir, 'nofm.md'), 'just text')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('loadBlogReleasePostsFromDir', () => {
  const load = () => loadBlogReleasePostsFromDir(dir, NOW)

  test('maps a published release to its blog URL, with and without v', () => {
    const map = load()
    expect(map.get('v0.3.6')).toBe('https://blog.chmonitor.dev/v0.3.6/')
    expect(map.get('0.3.6')).toBe('https://blog.chmonitor.dev/v0.3.6/')
  })

  test('never links drafts, future-dated, non-Release or versionless posts (404s)', () => {
    expect([...load().keys()].sort()).toEqual([
      '0.3',
      '0.3.0',
      '0.3.6',
      'v0.3',
      'v0.3.0',
      'v0.3.6',
    ])
  })

  test('a minor post (v0.3) links the v0.3.0 release tag', () => {
    expect(load().get('v0.3.0')).toBe('https://blog.chmonitor.dev/v0.3/')
  })

  test('missing directory yields an empty map instead of throwing', () => {
    expect(loadBlogReleasePostsFromDir(join(dir, 'nope'), NOW).size).toBe(0)
  })
})
