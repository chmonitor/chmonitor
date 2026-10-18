/**
 * Every cluster fan-out query must tolerate a dead replica.
 *
 * `clusterAllReplicas(...)` and `cluster(...)` fail the whole query when one
 * replica is unreachable, unless the query sets `skip_unavailable_shards = 1`.
 * Those queries exist to show cluster health, so failing exactly when a node
 * is down hides the outage they should report (#3894). The shared clause is
 * `CLUSTER_FANOUT_SETTINGS` in apps/dashboard/src/lib/cluster/fanout-settings.ts.
 * Declarative catalog twins may inline the same settings.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

const SCAN_ROOTS = ['apps/dashboard/src', 'packages']

/** Generated AI-agent skill bundle: markdown prose, not executed SQL. */
const EXCLUDED = ['apps/dashboard/src/lib/ai/agent/skills/registry.ts']

const FANOUT = /\b(?:FROM|JOIN)\s+(?:clusterAllReplicas|cluster)\s*\(/i
const HAS_SETTINGS =
  /\$\{CLUSTER_FANOUT_SETTINGS\}|skip_unavailable_shards\s*=\s*1/

function isSource(path: string): boolean {
  return (
    /\.tsx?$/.test(path) &&
    !/\.(test|spec|cy)\.tsx?$/.test(path) &&
    !path.includes('__tests__')
  )
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, out)
    else if (isSource(path)) out.push(path)
  }
}

/** Comments may quote fan-out SQL in prose; only string literals run. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

interface FanoutLiteral {
  file: string
  ok: boolean
}

function fanoutLiterals(): FanoutLiteral[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) walk(join(ROOT, root), files)
  const found: FanoutLiteral[] = []
  for (const path of files) {
    const file = relative(ROOT, path)
    if (EXCLUDED.includes(file)) continue
    const source = stripComments(readFileSync(path, 'utf8'))
    for (const literal of source.match(/`[^`]*`/g) ?? []) {
      if (FANOUT.test(literal)) {
        found.push({ file, ok: HAS_SETTINGS.test(literal) })
      }
    }
  }
  return found
}

describe('cluster fan-out queries skip unavailable replicas', () => {
  const literals = fanoutLiterals()

  test('the scan sees the known fan-out queries', () => {
    const files = new Set(literals.map((l) => l.file))
    for (const known of [
      'apps/dashboard/src/lib/api/cluster-count-registry.ts',
      'apps/dashboard/src/lib/health/cluster-fanout.ts',
      'apps/dashboard/src/routes/api/v1/notifications.ts',
      'apps/dashboard/src/lib/query-config/system/replicas-status.ts',
      'apps/dashboard/src/lib/schema-diff/cluster-sql.ts',
      'apps/dashboard/src/lib/settings-diff/cluster-sql.ts',
    ]) {
      expect(files).toContain(known)
    }
    expect(literals.length).toBeGreaterThanOrEqual(10)
  })

  test('every fan-out query carries CLUSTER_FANOUT_SETTINGS', () => {
    const missing = literals.filter((l) => !l.ok).map((l) => l.file)
    expect(missing).toEqual([])
  })
})
