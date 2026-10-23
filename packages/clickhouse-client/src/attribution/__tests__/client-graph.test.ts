/**
 * The browser bundle reaches `scope.ts` through the package index. In
 * `vite dev` a `node:*` import in that graph is an externalized proxy that
 * throws on access, and every page renders blank. Walk the graph the way the
 * client build resolves it (`browser` condition) and require no node builtin.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ATTRIBUTION_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..'
)
const PACKAGE_DIR = resolve(ATTRIBUTION_DIR, '../..')
const packageJson = JSON.parse(
  readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')
) as { imports: Record<string, Record<string, string>> }

const IMPORT_RE = /^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm

function resolveForBrowser(specifier: string, from: string): string | null {
  if (specifier.startsWith('#')) {
    const target = packageJson.imports[specifier]?.browser
    if (!target) throw new Error(`${specifier} has no browser condition`)
    return join(PACKAGE_DIR, target)
  }
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`)
}

/** Every bare or builtin specifier imported by the client graph of `entry`. */
function clientGraphExternals(entry: string): Map<string, string> {
  const externals = new Map<string, string>()
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const specifier = match[1] as string
      const next = resolveForBrowser(specifier, file)
      if (next) queue.push(next)
      else externals.set(specifier, file)
    }
  }
  return externals
}

describe('attribution client graph', () => {
  it('imports no node builtin under the browser condition', () => {
    const externals = clientGraphExternals(join(ATTRIBUTION_DIR, 'scope.ts'))
    const builtins = [...externals].filter(([s]) => s.startsWith('node:'))
    expect(builtins).toEqual([])
  })

  it('still gives the server real AsyncLocalStorage storage', () => {
    const map = packageJson.imports['#attribution-storage'] as Record<
      string,
      string
    >
    for (const condition of ['workerd', 'node', 'default']) {
      expect(map[condition]).toBe('./src/attribution/storage.ts')
    }
    const server = readFileSync(join(ATTRIBUTION_DIR, 'storage.ts'), 'utf8')
    expect(server).toContain("from 'node:async_hooks'")
  })
})
