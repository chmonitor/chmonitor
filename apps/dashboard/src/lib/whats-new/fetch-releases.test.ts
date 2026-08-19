import { parseAirgapSnapshot } from './airgap-snapshot'
import bundledSnapshot from './airgap-snapshot.json'
import { GITHUB_RELEASES_API_URL } from './constants'
import {
  loadReleases,
  parseGithubReleases,
  resetReleasesCacheForTests,
} from './fetch-releases'
import { afterEach, describe, expect, test } from 'bun:test'

const GITHUB_JSON = JSON.stringify([
  {
    tag_name: 'v0.3.3',
    published_at: '2026-08-15T12:00:00Z',
    draft: false,
    prerelease: false,
    body: `## 📊 Release recap\n\n- shoutout\n\n### ✨ Features\n\n* **ui:** add settings icon\n`,
  },
  {
    tag_name: 'chm-v0.1.1',
    published_at: '2026-08-06T12:00:00Z',
    draft: false,
    prerelease: false,
    body: 'CLI notes',
  },
  {
    tag_name: 'helm-chmonitor-0.2.0',
    published_at: '2026-08-01T12:00:00Z',
    draft: false,
    prerelease: false,
    body: 'Helm notes',
  },
])

const originalFetch = globalThis.fetch

afterEach(() => {
  resetReleasesCacheForTests()
  globalThis.fetch = originalFetch
})

const snapshotNotes = parseAirgapSnapshot(bundledSnapshot)
const noFriendly: [] = []

function mockFetch(
  impl: (
    url: string
  ) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const result = await impl(url)
    return {
      ok: result.ok,
      status: result.status,
      text: result.text,
    } as Response
  }) as typeof fetch
}

describe('parseGithubReleases', () => {
  test('filters to vX.Y.Z and strips recap from the body', () => {
    const notes = parseGithubReleases(GITHUB_JSON)
    expect(notes.map((n) => n.tag)).toEqual(['v0.3.3'])
    expect(notes[0]?.markdown).toContain('Features')
    expect(notes[0]?.markdown).not.toContain('shoutout')
  })
})

describe('loadReleases', () => {
  test('returns GitHub notes on success', async () => {
    mockFetch(async (url) => {
      if (url.startsWith(GITHUB_RELEASES_API_URL.split('?')[0]!)) {
        return { ok: true, status: 200, text: async () => GITHUB_JSON }
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const payload = await loadReleases(Date.now(), snapshotNotes, noFriendly)
    expect(payload.success).toBe(true)
    expect(payload.source).toBe('github')
    expect(payload.data[0]?.version).toBe('0.3.3')
    expect(payload.data[0]?.markdown).toContain('Features')
  })

  test('overlays friendly notes over a GitHub recap dump', async () => {
    mockFetch(async (url) => {
      if (url.startsWith(GITHUB_RELEASES_API_URL.split('?')[0]!)) {
        return { ok: true, status: 200, text: async () => GITHUB_JSON }
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const payload = await loadReleases(Date.now(), snapshotNotes, [
      {
        version: '0.3.3',
        date: '2026-08-16',
        summary: 'Guest AI caps and simpler alerts.',
        bullets: ['Cap guest AI usage on Cloud.'],
        screenshots: [],
      },
    ])
    expect(payload.data[0]?.kind).toBe('friendly')
    expect(payload.data[0]?.summary).toContain('Guest AI caps')
    expect(payload.data[0]?.markdown).not.toContain('shoutout')
    expect(payload.data[0]?.markdown).toContain('Cap guest AI usage')
  })

  test('falls back to the bundled snapshot when GitHub is down', async () => {
    const urls: string[] = []
    mockFetch(async (url) => {
      urls.push(url)
      return { ok: false, status: 503, text: async () => 'down' }
    })

    const payload = await loadReleases(Date.now(), snapshotNotes, noFriendly)
    expect(payload.success).toBe(true)
    expect(payload.source).toBe('snapshot')
    expect(payload.data.length).toBeGreaterThan(0)
    expect(payload.data[0]?.markdown).toContain('Features')
    expect(urls.some((url) => url.includes('raw.githubusercontent'))).toBe(
      false
    )
    expect(urls).toHaveLength(1)
  })

  test('returns a quiet failure when GitHub is down and the snapshot is empty', async () => {
    mockFetch(async () => ({ ok: false, status: 500, text: async () => '' }))

    const payload = await loadReleases(Date.now(), [], noFriendly)
    expect(payload.success).toBe(false)
    expect(payload.source).toBe('none')
    expect(payload.data).toEqual([])
    expect(payload.error).toContain('unavailable')
  })
})
