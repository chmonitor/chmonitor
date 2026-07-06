import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ChangelogFeature,
  type ChangelogFeatureGroup,
  groupChangelogFeatures,
  parseChangelogFeatures,
} from '@/lib/parse-changelog-features'

function resolveChangelogPath(): string {
  const candidates = [
    join(process.cwd(), '../../CHANGELOG.md'),
    fileURLToPath(new URL('../../../../CHANGELOG.md', import.meta.url)),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error('CHANGELOG.md not found')
}

let cached: {
  features: ChangelogFeature[]
  groups: ChangelogFeatureGroup[]
  totalCount: number
} | null = null

export function loadChangelogFeatures() {
  if (cached) return cached

  const markdown = readFileSync(resolveChangelogPath(), 'utf8')
  const features = parseChangelogFeatures(markdown)
  const groups = groupChangelogFeatures(features)

  cached = {
    features,
    groups,
    totalCount: features.length,
  }

  return cached
}
