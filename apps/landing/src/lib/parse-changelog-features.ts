export type ChangelogFeature = {
  scope: string
  title: string
  version?: string
  issue?: string
}

export type ChangelogFeatureGroup = {
  scope: string
  features: ChangelogFeature[]
}

const FEATURE_SECTION = '✨ Features'
const VERSION_RE = /^## \[([^\]]+)\]/
const BULLET_RE = /^[*-] \*\*([^:*]+):\*\* (.+)$/

/** Strip commit links, issue links, and trailing hashes from a feature title. */
export function cleanFeatureTitle(raw: string): string {
  return raw
    .replace(/\(\[#\d+\]\([^)]+\)\)/g, '')
    .replace(/\[#\d+\]\([^)]+\)/g, '')
    .replace(/\(\[[a-f0-9]+\]\([^)]+\)\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseChangelogFeatures(markdown: string): ChangelogFeature[] {
  const lines = markdown.split('\n')
  let inFeatures = false
  let currentVersion: string | undefined
  const features: ChangelogFeature[] = []

  for (const line of lines) {
    const versionMatch = line.match(VERSION_RE)
    if (versionMatch) {
      currentVersion = versionMatch[1]
      inFeatures = false
      continue
    }

    if (line.startsWith('### ')) {
      inFeatures = line.includes(FEATURE_SECTION)
      continue
    }

    if (!inFeatures) continue

    const bulletMatch = line.match(BULLET_RE)
    if (!bulletMatch) continue

    const [, scope, rest] = bulletMatch
    const issueMatch = rest.match(/#(\d+)/)

    features.push({
      scope: scope.trim(),
      title: cleanFeatureTitle(rest),
      version: currentVersion,
      issue: issueMatch?.[1],
    })
  }

  return features
}

export function groupChangelogFeatures(
  features: ChangelogFeature[]
): ChangelogFeatureGroup[] {
  const map = new Map<string, ChangelogFeature[]>()

  for (const feature of features) {
    const bucket = map.get(feature.scope) ?? []
    bucket.push(feature)
    map.set(feature.scope, bucket)
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scope, groupFeatures]) => ({ scope, features: groupFeatures }))
}

/** Compact label for scope filter chips (full id stays in title/tooltip). */
export function scopeChipLabel(scope: string, maxLen = 16): string {
  const normalized = scope.replace(/^ch-/, '').replace(/,/g, '·')
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen - 1)}…`
}

/** Count ✨ Features bullets — used by tests to prove parser completeness. */
export function countFeatureBulletsInMarkdown(markdown: string): number {
  const lines = markdown.split('\n')
  let inFeatures = false
  let count = 0

  for (const line of lines) {
    if (line.startsWith('### ')) {
      inFeatures = line.includes(FEATURE_SECTION)
      continue
    }
    if (inFeatures && BULLET_RE.test(line)) count++
  }

  return count
}
