#!/usr/bin/env node
// Scaffolds a DRAFT release blog post from a GitHub release.
//
// Usage (from apps/blog/):
//   bun run release-to-post <tag>                        # fetch via `gh` CLI
//   bun run release-to-post <tag> -- --from-file f.json   # offline/test input
//
// This never publishes anything — it writes src/content/blog/<slug>.md with
// `draft: true` and leaves the claim-verification checklist comment intact,
// exactly like copying templates/release-post.md by hand would. A human must
// review, verify every claim against the code/changelog, remove the checklist
// comment, and flip draft to false before it goes live.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')
const TEMPLATE_PATH = join(APP_ROOT, 'templates', 'release-post.md')
const POSTS_DIR = join(APP_ROOT, 'src', 'content', 'blog')

function parseArgs(argv) {
  const tag = argv.find((a) => !a.startsWith('--'))
  const fileFlagIndex = argv.indexOf('--from-file')
  const fromFile = fileFlagIndex >= 0 ? argv[fileFlagIndex + 1] : null
  if (!tag) {
    console.error('Usage: bun run release-to-post <tag> [-- --from-file <path>]')
    process.exit(1)
  }
  return { tag, fromFile }
}

/** Fetch release metadata: from a JSON file (offline/test) or the `gh` CLI. */
function loadRelease(tag, fromFile) {
  if (fromFile) {
    return JSON.parse(readFileSync(fromFile, 'utf8'))
  }
  try {
    const json = execFileSync(
      'gh',
      ['release', 'view', tag, '--json', 'tagName,name,body,publishedAt,url'],
      { encoding: 'utf8' }
    )
    return JSON.parse(json)
  } catch (err) {
    console.error(
      `Failed to fetch release "${tag}" via \`gh release view\`. ` +
        `Pass --from-file <path> with {tagName, name, body, publishedAt, url} to run offline.\n${err.message}`
    )
    process.exit(1)
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** First non-empty line of the release body, used as a rough description seed. */
function firstLine(body) {
  const line = (body ?? '').split('\n').find((l) => l.trim().length > 0)
  return line ? line.trim().replace(/^#+\s*/, '') : ''
}

function toIsoDate(dateString) {
  const d = dateString ? new Date(dateString) : new Date()
  return d.toISOString().slice(0, 10)
}

function main() {
  const { tag, fromFile } = parseArgs(process.argv.slice(2))
  const release = loadRelease(tag, fromFile)

  const version = release.tagName ?? tag
  const title = release.name || `chmonitor ${version}`
  const date = toIsoDate(release.publishedAt)
  const description = firstLine(release.body) || `What's new in chmonitor ${version}.`
  const releaseUrl =
    release.url ?? `https://github.com/chmonitor/chmonitor/releases/tag/${version}`
  const slug = slugify(title) || slugify(version)

  let template = readFileSync(TEMPLATE_PATH, 'utf8')

  // Strip the leading scaffold-instructions comment (the block starting with
  // "Release post template." above the frontmatter) — it's for humans copying
  // the file by hand, not for a generated draft.
  template = template.replace(/^<!--[\s\S]*?-->\n/, '')

  template = template
    .replace('title: "chmonitor vX.Y — <one-line theme>"', `title: "${title.replace(/"/g, "'")}"`)
    .replace(
      'description: "<1-2 sentence summary of what shipped, written for a SERP snippet>"',
      `description: "${description.replace(/"/g, "'")}"`
    )
    .replace('date: YYYY-MM-DD', `date: ${date}`)
    .replace('tag: Release\nversion: vX.Y', `tag: Release\nversion: ${version}\ndraft: true`)
    .replace(
      '[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/vX.Y)',
      `[GitHub release](${releaseUrl})`
    )

  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true })
  const outPath = join(POSTS_DIR, `${slug}.md`)
  if (existsSync(outPath)) {
    console.error(`${outPath} already exists — refusing to overwrite. Delete it first if intended.`)
    process.exit(1)
  }
  writeFileSync(outPath, template)
  console.log(`Draft scaffolded: ${outPath}`)
  console.log('draft: true — review, verify every claim, then flip to false before publishing.')
}

main()
