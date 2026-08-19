import type { ReleaseNote, ReleasesPayload } from './types'

import { parseAirgapSnapshot } from './airgap-snapshot'
import bundledSnapshot from './airgap-snapshot.json'
import {
  GITHUB_RELEASES_API_URL,
  MAX_RELEASES,
  RELEASES_CACHE_TTL_MS,
  RELEASES_FETCH_TIMEOUT_MS,
} from './constants'
import { buildReleaseNote } from './parse-release-body'
import { isProductVersionTag } from './version'

interface GithubReleaseJson {
  tag_name?: unknown
  published_at?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

interface CacheEntry {
  expiresAt: number
  payload: ReleasesPayload
}

let memoryCache: CacheEntry | null = null

const bundledSnapshotNotes: ReleaseNote[] = parseAirgapSnapshot(bundledSnapshot)

export function resetReleasesCacheForTests(): void {
  memoryCache = null
}

async function fetchText(
  url: string,
  headers: Record<string, string>
): Promise<string> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(RELEASES_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`)
  }
  return response.text()
}

function parseGithubReleases(raw: string): ReleaseNote[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []

  const notes: ReleaseNote[] = []
  for (const item of parsed as GithubReleaseJson[]) {
    if (item.draft === true || item.prerelease === true) continue
    if (typeof item.tag_name !== 'string') continue
    if (!isProductVersionTag(item.tag_name)) continue
    const body = typeof item.body === 'string' ? item.body : ''
    const publishedAt =
      typeof item.published_at === 'string' ? item.published_at : null
    notes.push(
      buildReleaseNote({
        version: item.tag_name,
        publishedAt,
        markdown: body,
      })
    )
    if (notes.length >= MAX_RELEASES) break
  }
  return notes
}

async function fetchGithubReleases(): Promise<ReleaseNote[]> {
  const raw = await fetchText(GITHUB_RELEASES_API_URL, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chmonitor-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  })
  return parseGithubReleases(raw)
}

function snapshotPayload(
  notes: readonly ReleaseNote[]
): ReleasesPayload | null {
  if (notes.length === 0) return null
  return {
    success: true,
    source: 'snapshot',
    data: [...notes],
  }
}

/**
 * Load product release notes: GitHub Releases first, then the build-time
 * airgap snapshot. Never fetches CHANGELOG.md (too large for the client or
 * a runtime fallback). Cached in memory for ~1 hour. Public repo only.
 *
 * Server-only — do not import this module from client components.
 */
export async function loadReleases(
  now = Date.now(),
  snapshot: readonly ReleaseNote[] = bundledSnapshotNotes
): Promise<ReleasesPayload> {
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.payload
  }

  try {
    const data = await fetchGithubReleases()
    if (data.length > 0) {
      const payload: ReleasesPayload = {
        success: true,
        source: 'github',
        data,
      }
      memoryCache = { expiresAt: now + RELEASES_CACHE_TTL_MS, payload }
      return payload
    }
  } catch {
    // Fall through to the bundled snapshot.
  }

  const fallback = snapshotPayload(snapshot)
  if (fallback) {
    memoryCache = { expiresAt: now + RELEASES_CACHE_TTL_MS, payload: fallback }
    return fallback
  }

  return {
    success: false,
    source: 'none',
    data: [],
    error: 'Release notes are temporarily unavailable.',
  }
}

export { parseGithubReleases }
