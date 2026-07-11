// Copy the shared image library (repo-root assets/**) into an app's
// public/assets/ directory so every site (landing, docs, blog) serves the
// same screenshots and backgrounds at /assets/<category>/<file>.
//
// assets/** is the single committed source of truth; apps/*/public/assets/
// is a generated artifact (gitignored). Runs as a prebuild/predev step from
// each app: `node ../../scripts/sync-shared-assets.mjs`.
//
// The copy is incremental (size + mtime) so repeated dev runs are cheap.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(REPO_ROOT, 'assets')
const DEST = resolve(process.cwd(), 'public/assets')

if (!existsSync(SRC)) {
  console.error(`sync-shared-assets: missing source dir ${SRC}`)
  process.exit(1)
}

const skip = (name) => name === '.DS_Store'

function syncDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  const srcEntries = readdirSync(src, { withFileTypes: true })
  const srcNames = new Set(srcEntries.map((e) => e.name))

  // Remove stale files so deletions in assets/ propagate.
  for (const name of readdirSync(dest)) {
    if (!srcNames.has(name) || skip(name)) rmSync(join(dest, name), { recursive: true })
  }

  let copied = 0
  for (const entry of srcEntries) {
    if (skip(entry.name)) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copied += syncDir(from, to)
      continue
    }
    const s = statSync(from)
    const d = existsSync(to) ? statSync(to) : null
    if (!d || d.size !== s.size || d.mtimeMs < s.mtimeMs) {
      cpSync(from, to)
      copied++
    }
  }
  return copied
}

const copied = syncDir(SRC, DEST)
console.log(`sync-shared-assets: ${copied} file(s) copied to ${DEST}`)
