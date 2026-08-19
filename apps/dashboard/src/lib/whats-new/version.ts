const PRODUCT_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/
const PRODUCT_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/
const SKIP_TAG_PREFIXES = ['chm-', 'helm-chmonitor-'] as const

export type SemverTriple = readonly [
  major: number,
  minor: number,
  patch: number,
]

/**
 * Product dashboard tags are `vX.Y.Z` only. CLI (`chm-v*`) and Helm
 * (`helm-chmonitor-*`) tags are skipped even when they embed a semver.
 */
export function isProductVersionTag(tag: string): boolean {
  const trimmed = tag.trim()
  for (const prefix of SKIP_TAG_PREFIXES) {
    if (trimmed.startsWith(prefix)) return false
  }
  return PRODUCT_TAG_RE.test(trimmed)
}

export function parseSemver(value: string): SemverTriple | null {
  const match = value.trim().match(PRODUCT_VERSION_RE)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function normalizeVersion(value: string): string {
  const parsed = parseSemver(value)
  if (!parsed) return value.trim().replace(/^v/i, '')
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}`
}

export function toProductTag(version: string): string {
  return `v${normalizeVersion(version)}`
}

/** Positive when `a` is newer than `b`. Null/unparseable values sort as older. */
export function compareVersions(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  for (let i = 0; i < 3; i++) {
    const diff = left[i]! - right[i]!
    if (diff !== 0) return diff
  }
  return 0
}

export function isVersionNewer(current: string, seen: string): boolean {
  return compareVersions(current, seen) > 0
}

/**
 * True when the running app version is newer than a persisted last-seen
 * version. An empty last-seen is "unseen" for the badge, but is not treated
 * as an upgrade (no auto-open) — that is handled separately.
 */
export function hasUnseenChangelog(
  appVersion: string,
  lastSeenChangelogVersion: string | undefined | null
): boolean {
  const seen = lastSeenChangelogVersion?.trim() ?? ''
  if (seen === '') return true
  return isVersionNewer(appVersion, seen)
}

/** Upgrade = we have a previous last-seen AND the app is newer. */
export function hasUnseenUpgrade(
  appVersion: string,
  lastSeenChangelogVersion: string | undefined | null
): boolean {
  const seen = lastSeenChangelogVersion?.trim() ?? ''
  if (seen === '') return false
  return isVersionNewer(appVersion, seen)
}

export function parseLastSeenChangelogVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  return parseSemver(trimmed) ? normalizeVersion(trimmed) : ''
}
