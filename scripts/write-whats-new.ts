#!/usr/bin/env bun

/**
 * Write docs/whats-new/vX.Y.Z.md from a detailed GitHub Release body plus
 * CHANGELOG Unreleased Highlights. Does not edit the GitHub Release.
 *
 *   bun scripts/write-whats-new.ts --tag v0.3.4
 *   bun scripts/write-whats-new.ts --tag v0.3.4 --release-notes release-notes.md --ai-file ai-whats-new.md
 */

import {
  draftFriendlyNoteMarkdown,
  pickFriendlyNoteMarkdown,
} from '../apps/dashboard/src/lib/whats-new/draft-friendly-note'
import {
  normalizeVersion,
  toProductTag,
} from '../apps/dashboard/src/lib/whats-new/version'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function isoDate(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return new Date().toISOString().slice(0, 10)
}

function readOptional(path: string | undefined): string {
  if (!path) return ''
  const resolved = resolve(path)
  if (!existsSync(resolved)) return ''
  return readFileSync(resolved, 'utf8')
}

const tagArg = argValue('--tag') ?? process.env.RELEASE_TAG
if (!tagArg) {
  console.error('usage: bun scripts/write-whats-new.ts --tag vX.Y.Z')
  process.exit(1)
}

const tag = toProductTag(tagArg)
const version = normalizeVersion(tag)
const date = isoDate(argValue('--date') ?? process.env.RELEASE_DATE)
const outDir = resolve(
  argValue('--out-dir') ?? join(REPO_ROOT, 'docs/whats-new')
)
const outPath = join(outDir, `${tag}.md`)

const releaseNotes =
  readOptional(argValue('--release-notes')) ||
  readOptional(join(process.cwd(), 'release-notes.md')) ||
  readOptional(join(REPO_ROOT, 'release-notes.md'))

if (!releaseNotes.trim()) {
  console.error('No release-notes.md found. Pass --release-notes <file>.')
  process.exit(1)
}

const changelog =
  readOptional(argValue('--changelog')) ||
  readOptional(join(REPO_ROOT, 'CHANGELOG.md'))

const deterministic = draftFriendlyNoteMarkdown({
  version,
  date,
  releaseBody: releaseNotes,
  changelogMarkdown: changelog || undefined,
})

const aiFile = readOptional(argValue('--ai-file'))
const markdown = pickFriendlyNoteMarkdown(deterministic, aiFile, version)

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, markdown)
console.log(`Wrote ${outPath}`)
