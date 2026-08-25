import {
  EMPTY_CHANGELOG_BUILD_ERROR,
  fetchGithubProductReleases,
  loadLandingReleases,
  mergeLandingReleases,
} from './load-landing-releases'
import { parseChangelogReleases } from './parse-changelog-releases'
import { describe, expect, test } from 'bun:test'

const CHANGELOG = `# Changelog
## [0.3.4](https://github.com/chmonitor/chmonitor/compare/v0.3.3...v0.3.4) (2026-08-24)
* **landing:** restore changelog cards
## [0.3.3](https://github.com/chmonitor/chmonitor/compare/v0.3.2...v0.3.3) (2026-08-15)
* **dashboard:** what's new
`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cliFloodPage() {
  return Array.from({ length: 100 }, (_, i) => ({
    tag_name: i === 0 ? 'chm-v0.1.0' : `chm-v0.1.2-beta.${i}`,
    draft: i === 0,
    prerelease: i !== 0,
    html_url: `https://github.com/chmonitor/chmonitor/releases/tag/${i === 0 ? 'chm-v0.1.0' : `chm-v0.1.2-beta.${i}`}`,
    body: '',
  }))
}

describe('fetchGithubProductReleases', () => {
  test('walks past CLI tags on page 1 to product vX.Y.Z tags', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const page = new URL(String(input)).searchParams.get('page')
      if (page === '1') return jsonResponse(cliFloodPage())
      if (page === '2') {
        return jsonResponse([
          {
            tag_name: 'v0.3.4',
            name: 'v0.3.4',
            published_at: '2026-08-24T12:56:30Z',
            html_url:
              'https://github.com/chmonitor/chmonitor/releases/tag/v0.3.4',
            body: 'GitHub body',
            draft: false,
            prerelease: false,
          },
          {
            tag_name: 'helm-chmonitor-0.2.15',
            draft: false,
            prerelease: false,
            html_url:
              'https://github.com/chmonitor/chmonitor/releases/tag/helm-chmonitor-0.2.15',
            body: '',
          },
        ])
      }
      return jsonResponse([])
    }

    const releases = await fetchGithubProductReleases({
      fetch: fetchImpl,
      retries: 0,
      sleep: async () => {},
    })
    expect(releases.map((r) => r.tag_name)).toEqual(['v0.3.4'])
    expect(releases[0]?.body).toBe('GitHub body')
  })

  test('sends User-Agent and optional token', async () => {
    let headers: HeadersInit | undefined
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = init?.headers
      return jsonResponse([])
    }
    await fetchGithubProductReleases({
      fetch: fetchImpl,
      token: 'ghp_test',
      retries: 0,
      sleep: async () => {},
    })
    const record = new Headers(headers)
    expect(record.get('User-Agent')).toBe('chmonitor-landing')
    expect(record.get('Authorization')).toBe('Bearer ghp_test')
  })

  test('retries a 403 then succeeds', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ message: 'rate limit' }, 403)
      return jsonResponse([
        {
          tag_name: 'v0.3.4',
          name: 'v0.3.4',
          published_at: '2026-08-24T12:56:30Z',
          html_url:
            'https://github.com/chmonitor/chmonitor/releases/tag/v0.3.4',
          body: 'ok',
          draft: false,
          prerelease: false,
        },
      ])
    }

    const releases = await fetchGithubProductReleases({
      fetch: fetchImpl,
      retries: 2,
      sleep: async () => {},
    })
    expect(calls).toBe(2)
    expect(releases).toHaveLength(1)
  })

  test('returns an empty list after GitHub stays down', async () => {
    const releases = await fetchGithubProductReleases({
      fetch: async () => jsonResponse('nope', 503),
      retries: 1,
      sleep: async () => {},
    })
    expect(releases).toEqual([])
  })
})

describe('mergeLandingReleases', () => {
  test('keeps CHANGELOG order and overlays GitHub bodies', () => {
    const changelog = parseChangelogReleases(CHANGELOG)
    const merged = mergeLandingReleases(changelog, [
      {
        tag_name: 'v0.3.4',
        name: 'chmonitor v0.3.4',
        published_at: '2026-08-24T12:56:30Z',
        html_url: 'https://github.com/chmonitor/chmonitor/releases/tag/v0.3.4',
        body: 'GitHub highlights',
      },
    ])
    expect(merged.map((r) => r.tag_name)).toEqual(['v0.3.4', 'v0.3.3'])
    expect(merged[0]?.body).toBe('GitHub highlights')
    expect(merged[0]?.name).toBe('chmonitor v0.3.4')
    expect(merged[1]?.body).toContain("what's new")
  })
})

describe('loadLandingReleases', () => {
  test('renders CHANGELOG cards when GitHub page 1 is only CLI tags', async () => {
    const releases = await loadLandingReleases({
      changelogMarkdown: CHANGELOG,
      githubReleases: [],
      limit: 12,
    })
    expect(releases.map((r) => r.tag_name)).toEqual(['v0.3.4', 'v0.3.3'])
  })

  test('fails the build when both sources are empty', async () => {
    await expect(
      loadLandingReleases({
        changelogMarkdown: '# Changelog\n\n## [Unreleased]\n',
        githubReleases: [],
      })
    ).rejects.toThrow(EMPTY_CHANGELOG_BUILD_ERROR)
  })
})
