/**
 * Every ClickHouse client the app sends SQL through must carry attribution
 * (issue #4164). A client only exists through the `createClient` factory of
 * `@clickhouse/client` or `@clickhouse/client-web`, so the factory call is the
 * chokepoint: each call must be the first argument of `withQueryAttribution(`,
 * or its file must be in ALLOWED with a reason. A new raw client fails here.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../..'
)
const ROOTS = ['apps/dashboard/src', 'packages']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.turbo'])
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/
const TEST_FILE = /\.(test|spec|cy)\.[cm]?[jt]sx?$/

/** Files that create a client without wrapping it at the call, and why. */
const ALLOWED: Record<string, string> = {
  'packages/clickhouse-client/src/clickhouse/clickhouse-client.ts':
    'picks the factory at runtime (`clientFactory(...)`) and wraps the result in withQueryAttribution before pooling it; scope.test.ts covers the wrapper',
  'packages/clickhouse-client/scripts/verify-readonly-mode.ts':
    'manual probe that measures raw readonly behaviour, including the log_comment refusal itself; never shipped',
  'apps/dashboard/src/routes/api/v1/browser-connections/test.ts':
    'KNOWN GAP: "Test connection" sends `SELECT version()` to a user-supplied host unattributed; wrap it in withQueryAttribution in its own PR, then delete this entry',
}

const FACTORY_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*['"]@clickhouse\/client(?:-web)?['"]/g
const NAMESPACE_IMPORT =
  /import\s*\*\s*as\s+(\w+)\s+from\s*['"]@clickhouse\/client(?:-web)?['"]/g
const DYNAMIC_IMPORT =
  /(?:import|require)\(\s*['"]@clickhouse\/client(?:-web)?['"]\s*\)/

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name))
    } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield join(dir, entry.name)
    }
  }
}

/** Local names bound to a client factory in `text`, e.g. `createClientWeb`. */
function factoryNames(text: string): string[] {
  const names: string[] = []
  for (const [, specifiers] of text.matchAll(FACTORY_IMPORT)) {
    for (const spec of (specifiers as string).split(',')) {
      const m = spec.trim().match(/^createClient(?:\s+as\s+(\w+))?$/)
      if (m) names.push(m[1] ?? 'createClient')
    }
  }
  for (const [, ns] of text.matchAll(NAMESPACE_IMPORT)) {
    names.push(`${ns}.createClient`)
  }
  return names
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** Factory uses not of the form `withQueryAttribution(<factory>(`. */
function rawClientUses(file: string, text: string): Finding[] {
  const findings: Finding[] = []
  const rel = relative(REPO, file)
  if (DYNAMIC_IMPORT.test(text)) {
    findings.push({
      file: rel,
      line: 0,
      text: 'dynamic import of @clickhouse/client',
    })
  }
  for (const name of factoryNames(text)) {
    const use = new RegExp(
      `(^|[^\\w.])${name.replace('.', '\\.')}\\b(?!\\s+as\\b)`,
      'g'
    )
    for (const match of text.matchAll(use)) {
      const at = (match.index ?? 0) + match[1].length
      const before = text.slice(0, at)
      if (/import\s*(?:\{[^}]*|\*\s*as\s*)$/.test(before)) continue
      if (/\btypeof\s+$/.test(before)) continue
      if (/withQueryAttribution\(\s*$/.test(before)) continue
      const line = before.split('\n').length
      findings.push({
        file: rel,
        line,
        text: text.split('\n')[line - 1].trim(),
      })
    }
  }
  return findings
}

function scan(): Finding[] {
  const findings: Finding[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO, root))) {
      findings.push(...rawClientUses(file, readFileSync(file, 'utf8')))
    }
  }
  return findings
}

describe('attribution coverage', () => {
  const findings = scan()

  it('wraps every ClickHouse client the app creates in withQueryAttribution', () => {
    const unexplained = findings.filter((f) => !(f.file in ALLOWED))
    expect(unexplained).toEqual([])
  })

  it('keeps no stale allowlist entry', () => {
    const flagged = new Set(findings.map((f) => f.file))
    expect(Object.keys(ALLOWED).filter((f) => !flagged.has(f))).toEqual([])
  })

  it('sees the wrapped call sites, so a broken scan cannot pass vacuously', () => {
    const wrapped = ['proxy.ts', 'connection-client.ts'].map((name) => {
      const file = [...sourceFiles(join(REPO, 'apps/dashboard/src'))].find(
        (f) => f.endsWith(`/${name}`)
      ) as string
      const text = readFileSync(file, 'utf8')
      return (
        factoryNames(text).length > 0 && rawClientUses(file, text).length === 0
      )
    })
    expect(wrapped).toEqual([true, true])
  })

  it('flags a raw client, an aliased one, and a namespace import', () => {
    const cases = [
      "import { createClient } from '@clickhouse/client-web'\nconst c = createClient({})",
      "import { createClient as mk } from '@clickhouse/client'\nconst c = mk({})",
      "import * as ch from '@clickhouse/client-web'\nconst c = ch.createClient({})",
    ]
    expect(cases.map((t) => rawClientUses('/x.ts', t).length)).toEqual([
      1, 1, 1,
    ])
  })
})
