/**
 * Regression for #4178: `node:async_hooks` reached the browser graph and
 * `vite dev` rendered every page blank (Vite's externalized proxy throws on
 * access). The attribution package has its own guard; this one walks the whole
 * dashboard client graph, so the same mistake anywhere (a component, a lib, a
 * workspace package) fails here with the import chain.
 *
 * The graph is rooted at `router.tsx` plus every non-API route file (the
 * generated route tree is gitignored, so it is not read). Server-only code is
 * out of the graph: `routes/api`, `*.server.*`, tests. Only static imports are
 * followed, since a dynamic `import()` behind a runtime guard is legitimate.
 *
 * A module that header-comments `SERVER-ONLY MODULE` (e.g. `local-loader.ts`)
 * may import node builtins, but only because every importer gates the call on
 * the build-time `import.meta.env.SSR` constant. That is enforced here: such a
 * module ends the walk, and an importer without the gate is reported.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DASHBOARD_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..'
)
const SRC_DIR = join(DASHBOARD_DIR, 'src')
const REPO_DIR = resolve(DASHBOARD_DIR, '../..')

const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')))
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx']

const tsconfig = JSON.parse(
  readFileSync(join(DASHBOARD_DIR, 'tsconfig.json'), 'utf8')
) as { compilerOptions: { paths: Record<string, string[]> } }
const PATHS = Object.entries(tsconfig.compilerOptions.paths).filter(
  ([, targets]) => targets.every((t) => !t.includes('node_modules'))
)

// `import x from 'a'`, `import 'a'`, `export * from 'a'`; not `import type`.
const IMPORT_RE =
  /(?:^|\n)[ \t]*(?:import|export)\s+(?!type[\s{*])(?:[^'";]*?\sfrom\s+)?['"]([^'"\n]+)['"]/g

const SERVER_ONLY_MARKER = 'SERVER-ONLY MODULE'

function isServerOnly(file: string): boolean {
  const rel = relative(SRC_DIR, file).replaceAll('\\', '/')
  return (
    rel.startsWith('routes/api/') ||
    /\.server\.[cm]?[jt]sx?$/.test(rel) ||
    /(^|\/)__tests__\//.test(rel) ||
    /\.(test|spec|cy)\.[cm]?[jt]sx?$/.test(rel)
  )
}

function withExtension(base: string): string | null {
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => join(base, `index${e}`)),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function nearestPackageJson(file: string): Record<string, unknown> & {
  dir: string
} {
  let dir = dirname(file)
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir)
  return { ...JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')), dir }
}

/** Resolve like the client build; null means external or an asset. */
function resolveImport(specifier: string, from: string): string | null {
  if (specifier.startsWith('.')) {
    return withExtension(resolve(dirname(from), specifier))
  }
  if (specifier.startsWith('#')) {
    const pkg = nearestPackageJson(from) as {
      dir: string
      imports?: Record<string, string | Record<string, string>>
    }
    const entry = pkg.imports?.[specifier]
    const target =
      typeof entry === 'string' ? entry : (entry?.browser ?? entry?.default)
    return target ? withExtension(join(pkg.dir, target)) : null
  }
  if (specifier.startsWith('@/')) {
    return withExtension(join(SRC_DIR, specifier.slice(2)))
  }
  for (const [pattern, targets] of PATHS) {
    const target = targets[0] as string
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      if (specifier.startsWith(prefix)) {
        return withExtension(
          resolve(
            DASHBOARD_DIR,
            target.replace('*', specifier.slice(prefix.length))
          )
        )
      }
    } else if (pattern === specifier) {
      return withExtension(resolve(DASHBOARD_DIR, target))
    }
  }
  return null
}

function isBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    BUILTINS.has(specifier.split('/')[0] as string)
  )
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name)
    return d.isDirectory() ? listFiles(full) : [full]
  })
}

function clientEntries(): string[] {
  return [
    join(SRC_DIR, 'router.tsx'),
    ...listFiles(join(SRC_DIR, 'routes')).filter(
      (f) => /\.[jt]sx?$/.test(f) && !isServerOnly(f)
    ),
  ]
}

/** Every node builtin import in the client graph, with the chain that led to it. */
export function findNodeBuiltinChains(entries: string[]): string[] {
  const parent = new Map<string, string | null>()
  const queue: string[] = []
  for (const e of entries) {
    parent.set(e, null)
    queue.push(e)
  }
  const found: string[] = []
  const show = (f: string) => relative(REPO_DIR, f)
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i] as string
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] as string
      if (isBuiltin(specifier)) {
        const chain: string[] = []
        for (let f: string | null | undefined = file; f; f = parent.get(f)) {
          chain.unshift(show(f))
        }
        found.push(`${[...chain, specifier].join(' -> ')}`)
        continue
      }
      const next = resolveImport(specifier, file)
      if (next && readFileSync(next, 'utf8').includes(SERVER_ONLY_MARKER)) {
        if (!source.includes('import.meta.env.SSR')) {
          found.push(
            `${show(file)} imports ${show(next)} (${SERVER_ONLY_MARKER}) without an import.meta.env.SSR gate`
          )
        }
        continue
      }
      if (next && !parent.has(next) && !isServerOnly(next)) {
        parent.set(next, file)
        queue.push(next)
      }
    }
  }
  return found
}

describe('dashboard client import graph', () => {
  it('imports no node builtin', () => {
    const entries = clientEntries()
    expect(entries.length).toBeGreaterThan(50)
    expect(findNodeBuiltinChains(entries)).toEqual([])
  })
})
