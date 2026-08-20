// Copy scripts/install.sh into the landing public dir so browsers can open
// https://chmonitor.dev/install.sh (200 body, not a 302). The documented curl
// installer uses GitHub raw because Cloudflare Bot Fight Mode challenges curl
// on the apex; see scripts/cloudflare-allow-install-sh.ts.
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
