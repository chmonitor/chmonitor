#!/usr/bin/env bun

/**
 * Fill `.github/whats-new-prompt.md` placeholders for the release.yml
 * Copilot / GitHub Models step.
 *
 *   bun scripts/build-whats-new-prompt.ts \
 *     --tag v0.3.4 --date 2026-08-19 \
 *     --release-notes release-notes.md \
 *     --out whats-new-prompt.txt
 */

import { extractUnreleasedHighlights } from '../apps/dashboard/src/lib/whats-new/draft-friendly-note'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function readRequired(path: string): string {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`missing file: ${resolved}`)
  }
  return readFileSync(resolved, 'utf8')
}

const tag = argValue('--tag') ?? process.env.RELEASE_TAG ?? ''
const date = argValue('--date') ?? new Date().toISOString().slice(0, 10)
const notesPath = argValue('--release-notes')
const changelogPath = argValue('--changelog') ?? join(REPO_ROOT, 'CHANGELOG.md')
const templatePath =
  argValue('--template') ?? join(REPO_ROOT, '.github/whats-new-prompt.md')
const outPath = argValue('--out') ?? 'whats-new-prompt.txt'

if (!tag || !notesPath) {
  console.error(
    'usage: bun scripts/build-whats-new-prompt.ts --tag vX.Y.Z --release-notes <file>'
  )
  process.exit(1)
}

const highlights = existsSync(changelogPath)
  ? extractUnreleasedHighlights(readFileSync(changelogPath, 'utf8'))
  : {
      bullets: [] as string[],
      screenshots: [] as Array<{ src: string; alt: string }>,
    }

const highlightLines = [
  ...highlights.bullets.map((bullet) => `- ${bullet}`),
  ...highlights.screenshots.map(
    (shot) => `- ![${shot.alt || 'screenshot'}](${shot.src})`
  ),
]
const highlightsText = highlightLines.join('\n') || '(none)'

let template = readRequired(templatePath)
template = template.replaceAll('{{RELEASE_TAG}}', tag)
template = template.replaceAll('{{DATE}}', date)
template = template.replaceAll('{{HIGHLIGHTS}}', highlightsText)
template = template.replaceAll('{{RELEASE_NOTES}}', readRequired(notesPath))
writeFileSync(outPath, template)
console.log(`Wrote ${outPath}`)
