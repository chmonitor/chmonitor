import { readChangelogMarkdown } from '../lib/changelog-file'
import {
  type ChangelogFeature,
  type ChangelogFeatureGroup,
  groupChangelogFeatures,
  parseChangelogFeatures,
} from '../lib/parse-changelog-features'

let cached: {
  features: ChangelogFeature[]
  groups: ChangelogFeatureGroup[]
  totalCount: number
} | null = null

export function loadChangelogFeatures() {
  if (cached) return cached

  const markdown = readChangelogMarkdown()
  const features = parseChangelogFeatures(markdown)
  const groups = groupChangelogFeatures(features)

  cached = {
    features,
    groups,
    totalCount: features.length,
  }

  return cached
}

let cachedLatestVersion: string | null | undefined

/**
 * Latest released version from CHANGELOG.md (first `## [x.y.z]` heading),
 * e.g. `0.2.14`. Returns null when no versioned heading exists.
 */
export function loadLatestChangelogVersion(): string | null {
  if (cachedLatestVersion !== undefined) return cachedLatestVersion

  const markdown = readChangelogMarkdown()
  const match = markdown.match(/^## \[(\d+\.\d+\.\d+)\]/m)
  cachedLatestVersion = match ? match[1] : null
  return cachedLatestVersion
}
