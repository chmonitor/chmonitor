#!/usr/bin/env bun

/**
 * Bake the latest `v*` product notes from repo-root CHANGELOG.md into a small
 * JSON snapshot. Used as the airgap fallback for GET /api/v1/releases.
 *
 *   bun scripts/build-whats-new-snapshot.ts
 */

import { serializeAirgapSnapshot } from '../src/lib/whats-new/airgap-snapshot'
import { buildAirgapSnapshot } from '../src/lib/whats-new/parse-changelog'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_ROOT = dirname(SCRIPT_DIR)
const CHANGELOG_CANDIDATES = [
  join(DASHBOARD_ROOT, '../../CHANGELOG.md'),
  join(DASHBOARD_ROOT, '../CHANGELOG.md'),
]
const CHANGELOG_PATH =
  CHANGELOG_CANDIDATES.find((path) => existsSync(path)) ??
  CHANGELOG_CANDIDATES[0]!
const OUTPUT_PATH = join(
  DASHBOARD_ROOT,
  'src/lib/whats-new/airgap-snapshot.generated.json'
)

export function writeWhatsNewAirgapSnapshot(
  changelogPath = CHANGELOG_PATH,
  outputPath = OUTPUT_PATH
): boolean {
  if (!existsSync(changelogPath)) return false
  const notes = buildAirgapSnapshot(readFileSync(changelogPath, 'utf8'))
  const next = serializeAirgapSnapshot(notes)
  const prev = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
  if (prev === next) return false
  writeFileSync(outputPath, next)
  return true
}

const isDirectRun = import.meta.main === true

if (isDirectRun) {
  const wrote = writeWhatsNewAirgapSnapshot()
  if (!existsSync(CHANGELOG_PATH)) {
    console.error(`CHANGELOG.md not found at ${CHANGELOG_PATH}`)
    process.exit(1)
  }
  console.log(
    wrote ? `Wrote ${OUTPUT_PATH}` : `Snapshot unchanged at ${OUTPUT_PATH}`
  )
}
