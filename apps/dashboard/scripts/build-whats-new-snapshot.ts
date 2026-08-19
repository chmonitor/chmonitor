#!/usr/bin/env bun

/**
 * Bake latest `v*` product notes (friendly files first, then CHANGELOG
 * Features) into gitignored JSON used by GET /api/v1/releases.
 *
 *   bun scripts/build-whats-new-snapshot.ts
 */

import { serializeAirgapSnapshot } from '../src/lib/whats-new/airgap-snapshot'
import { loadFriendlyNotesFromDir } from '../src/lib/whats-new/load-friendly-notes'
import { buildAirgapSnapshot } from '../src/lib/whats-new/parse-changelog'
import { serializeFriendlyNotesJson } from '../src/lib/whats-new/parse-friendly-note'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_ROOT = dirname(SCRIPT_DIR)
const REPO_ROOT = join(DASHBOARD_ROOT, '../..')
const CHANGELOG_CANDIDATES = [
  join(REPO_ROOT, 'CHANGELOG.md'),
  join(DASHBOARD_ROOT, '../CHANGELOG.md'),
]
const CHANGELOG_PATH =
  CHANGELOG_CANDIDATES.find((path) => existsSync(path)) ??
  CHANGELOG_CANDIDATES[0]!
const WHATS_NEW_DIR = join(REPO_ROOT, 'docs/whats-new')
const SNAPSHOT_PATH = join(
  DASHBOARD_ROOT,
  'src/lib/whats-new/airgap-snapshot.generated.json'
)
const FRIENDLY_PATH = join(
  DASHBOARD_ROOT,
  'src/lib/whats-new/friendly-notes.generated.json'
)
const FRIENDLY_FIXTURE_PATH = join(
  DASHBOARD_ROOT,
  'src/lib/whats-new/friendly-notes.json'
)

function writeIfChanged(path: string, next: string): boolean {
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (prev === next) return false
  writeFileSync(path, next)
  return true
}

export function writeWhatsNewAirgapSnapshot(
  changelogPath = CHANGELOG_PATH,
  snapshotPath = SNAPSHOT_PATH,
  whatsNewDir = WHATS_NEW_DIR,
  friendlyPath = FRIENDLY_PATH,
  friendlyFixturePath = FRIENDLY_FIXTURE_PATH
): boolean {
  const friendly = existsSync(whatsNewDir)
    ? loadFriendlyNotesFromDir(whatsNewDir)
    : []
  const friendlyJson = serializeFriendlyNotesJson(friendly)
  let wrote = writeIfChanged(friendlyPath, friendlyJson)
  wrote = writeIfChanged(friendlyFixturePath, friendlyJson) || wrote
  if (!existsSync(changelogPath)) return wrote
  const notes = buildAirgapSnapshot(
    readFileSync(changelogPath, 'utf8'),
    undefined,
    friendly
  )
  return writeIfChanged(snapshotPath, serializeAirgapSnapshot(notes)) || wrote
}

const isDirectRun = import.meta.main === true

if (isDirectRun) {
  const wrote = writeWhatsNewAirgapSnapshot()
  if (!existsSync(CHANGELOG_PATH)) {
    console.error(`CHANGELOG.md not found at ${CHANGELOG_PATH}`)
    process.exit(1)
  }
  console.log(
    wrote
      ? `Wrote ${SNAPSHOT_PATH} and friendly notes`
      : `Snapshot unchanged at ${SNAPSHOT_PATH}`
  )
}
