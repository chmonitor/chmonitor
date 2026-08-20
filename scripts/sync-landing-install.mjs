// Copy scripts/install.sh into the landing public dir so
// `curl -sSf https://chmonitor.dev/install.sh | bash` hits a 200 body, not
// a 302 to GitHub (curl -sSf does not follow redirects, so the pipe was empty).
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(REPO_ROOT, 'scripts', 'install.sh')
const DEST = resolve(process.cwd(), 'public', 'install.sh')

if (!existsSync(SRC)) {
  console.error(`sync-landing-install: missing ${SRC}`)
  process.exit(1)
}

copyFileSync(SRC, DEST)
console.log(`sync-landing-install: ${SRC} -> ${DEST}`)
