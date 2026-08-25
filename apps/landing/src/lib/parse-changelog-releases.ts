import { isProductReleaseTag } from './parse-github-release-notes'

const SECTION_RE = /^## \[([^\]]+)\](?:\([^)]+\))?(?:\s+\(([^)]+)\))?[ \t]*$/gm

export type LandingRelease = {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  body: string
}

export function githubReleaseUrl(tag: string): string {
  return `https://github.com/chmonitor/chmonitor/releases/tag/${tag}`
}

export function toProductReleaseTag(heading: string): string | null {
  const trimmed = heading.trim()
  if (/^unreleased$/i.test(trimmed)) return null
  const tag = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  return isProductReleaseTag(tag) ? tag : null
}

function parseChangelogDate(raw: string | undefined): string {
  if (!raw) return ''
  const isoDay = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return isoDay ? `${isoDay[1]}T00:00:00.000Z` : ''
}

/**
 * Product `vX.Y.Z` sections from CHANGELOG.md, newest first.
 * Skips Unreleased, CLI `chm-v*`, and Helm chart tags.
 */
export function parseChangelogReleases(markdown: string): LandingRelease[] {
  const text = markdown.replace(/\r\n/g, '\n')
  const matches = [...text.matchAll(SECTION_RE)]
  const releases: LandingRelease[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!
    const tag = toProductReleaseTag(match[1] ?? '')
    if (!tag) continue
    const start = (match.index ?? 0) + match[0].length
    const end =
      i + 1 < matches.length
        ? (matches[i + 1]!.index ?? text.length)
        : text.length
    releases.push({
      tag_name: tag,
      name: tag,
      published_at: parseChangelogDate(match[2]),
      html_url: githubReleaseUrl(tag),
      body: text.slice(start, end).trim(),
    })
  }

  return releases
}
