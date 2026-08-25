import { readChangelogMarkdown } from './changelog-file'
import { GITHUB_REPO } from './github-stars'
import {
  type LandingRelease,
  parseChangelogReleases,
} from './parse-changelog-releases'
import { isProductReleaseTag } from './parse-github-release-notes'

export type { LandingRelease } from './parse-changelog-releases'

export const LANDING_RELEASE_LIMIT = 12
export const GITHUB_RELEASES_PER_PAGE = 100
export const GITHUB_RELEASES_MAX_PAGES = 5
export const GITHUB_RELEASES_TIMEOUT_MS = 10_000
export const EMPTY_CHANGELOG_BUILD_ERROR =
  'Landing changelog is empty after CHANGELOG.md and GitHub Releases. Refusing to ship the empty SSG fallback.'

const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`

type FetchLike = typeof fetch

interface GithubReleaseJson {
  tag_name?: unknown
  name?: unknown
  published_at?: unknown
  html_url?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

export interface LoadLandingReleasesOptions {
  changelogMarkdown?: string
  /** Injected GitHub list. `null` skips the network fetch. */
  githubReleases?: LandingRelease[] | null
  fetch?: FetchLike
  token?: string
  retries?: number
  sleep?: (ms: number) => Promise<void>
  limit?: number
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chmonitor-landing',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function resolveGithubToken(explicit?: string): string | undefined {
  const token =
    explicit ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''
  return token.trim() || undefined
}

function asRelease(item: GithubReleaseJson): LandingRelease | null {
  if (item.draft === true || item.prerelease === true) return null
  if (typeof item.tag_name !== 'string') return null
  if (!isProductReleaseTag(item.tag_name)) return null
  return {
    tag_name: item.tag_name,
    name:
      typeof item.name === 'string' && item.name ? item.name : item.tag_name,
    published_at:
      typeof item.published_at === 'string' ? item.published_at : '',
    html_url:
      typeof item.html_url === 'string' && item.html_url
        ? item.html_url
        : `https://github.com/${GITHUB_REPO}/releases/tag/${item.tag_name}`,
    body: typeof item.body === 'string' ? item.body : '',
  }
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchGithubPage(
  url: string,
  fetchImpl: FetchLike,
  token: string | undefined,
  retries: number,
  sleep: (ms: number) => Promise<void>
): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1))
    try {
      const res = await fetchImpl(url, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(GITHUB_RELEASES_TIMEOUT_MS),
      })
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        lastError = new Error(`GitHub Releases HTTP ${res.status}`)
        continue
      }
      if (!res.ok) {
        throw new Error(`GitHub Releases HTTP ${res.status}`)
      }
      return await res.json()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('GitHub Releases fetch failed')
}

/**
 * Product `vX.Y.Z` GitHub Releases, walking past CLI `chm-v*` / Helm tags.
 * Returns [] when GitHub is down so CHANGELOG.md can still fill the page.
 */
export async function fetchGithubProductReleases(
  options: LoadLandingReleasesOptions = {}
): Promise<LandingRelease[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const token = resolveGithubToken(options.token)
  const retries = options.retries ?? 3
  const sleep = options.sleep ?? defaultSleep
  const limit = options.limit ?? LANDING_RELEASE_LIMIT
  const collected: LandingRelease[] = []

  try {
    for (let page = 1; page <= GITHUB_RELEASES_MAX_PAGES; page++) {
      const url = `${GITHUB_RELEASES_API}?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`
      const raw = await fetchGithubPage(url, fetchImpl, token, retries, sleep)
      if (!Array.isArray(raw) || raw.length === 0) break
      for (const item of raw as GithubReleaseJson[]) {
        const release = asRelease(item)
        if (!release) continue
        collected.push(release)
        if (collected.length >= limit) return collected
      }
      if (raw.length < GITHUB_RELEASES_PER_PAGE) break
    }
  } catch {
    return []
  }

  return collected
}

export function mergeLandingReleases(
  changelog: readonly LandingRelease[],
  github: readonly LandingRelease[]
): LandingRelease[] {
  const byTag = new Map(github.map((release) => [release.tag_name, release]))
  if (changelog.length === 0) return [...github]
  return changelog.map((local) => {
    const remote = byTag.get(local.tag_name)
    return remote ? { ...local, ...remote } : local
  })
}

/**
 * Build-time changelog cards: CHANGELOG.md is the list, GitHub enriches
 * bodies/dates, docs/whats-new overlays in the page. Empty list fails the build.
 */
export async function loadLandingReleases(
  options: LoadLandingReleasesOptions = {}
): Promise<LandingRelease[]> {
  const limit = options.limit ?? LANDING_RELEASE_LIMIT
  const changelog = parseChangelogReleases(
    options.changelogMarkdown ?? readChangelogMarkdown()
  )
  const github =
    options.githubReleases === undefined
      ? await fetchGithubProductReleases(options)
      : (options.githubReleases ?? [])
  const merged = mergeLandingReleases(changelog, github).slice(0, limit)
  if (merged.length === 0) {
    throw new Error(EMPTY_CHANGELOG_BUILD_ERROR)
  }
  return merged
}
