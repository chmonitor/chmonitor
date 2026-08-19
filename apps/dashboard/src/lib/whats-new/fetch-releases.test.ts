import { CHANGELOG_RAW_URL, GITHUB_RELEASES_API_URL } from './constants'
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

const CHANGELOG = `## [0.3.2](https://github.com/chmonitor/chmonitor/compare/v0.3.1...v0.3.2) (2026-08-12)

### ✨ Features

* **alerts:** redesign alert-settings
`

afterEach(() => {
  resetReleasesCacheForTests()
  globalThis.fetch = originalFetch
})

const originalFetch = globalThis.fetch

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

    const payload = await loadReleases()
    expect(payload.success).toBe(true)
    expect(payload.source).toBe('github')
    expect(payload.data[0]?.version).toBe('0.3.3')
  })

  test('falls back to CHANGELOG.md when GitHub is down', async () => {
    mockFetch(async (url) => {
      if (url.startsWith(GITHUB_RELEASES_API_URL.split('?')[0]!)) {
        return { ok: false, status: 503, text: async () => 'down' }
      }
      if (url === CHANGELOG_RAW_URL) {
        return { ok: true, status: 200, text: async () => CHANGELOG }
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const payload = await loadReleases()
    expect(payload.success).toBe(true)
    expect(payload.source).toBe('changelog')
    expect(payload.data[0]?.version).toBe('0.3.2')
    expect(payload.data[0]?.markdown).toContain('Features')
  })

  test('returns a quiet failure when both sources fail', async () => {
    mockFetch(async () => ({ ok: false, status: 500, text: async () => '' }))

    const payload = await loadReleases()
    expect(payload.success).toBe(false)
    expect(payload.source).toBe('none')
    expect(payload.data).toEqual([])
    expect(payload.error).toContain('unavailable')
  })
})
