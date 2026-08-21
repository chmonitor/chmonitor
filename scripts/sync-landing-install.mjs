// Copy scripts/install.sh into the landing public dir so
// https://chmonitor.dev/install.sh serves the script body (200, not a 302).
// Documented curl install uses that URL; see scripts/cloudflare-allow-install-sh.ts
// if Bot Fight Mode starts challenging curl again.
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
