/**
 * Guard: a health query that scans `system.tables` / `system.columns` must
 * restrict the scan to local database engines.
 *
 * Why a test and not a review rule: an unrestricted scan of a cluster holding a
 * few thousand remote-engine tables (`PostgreSQL`, `MySQL`, …) opens a catalog
 * connection per table to build `create_table_query` / `engine_full`. That
 * remote call cannot be interrupted, so `max_execution_time` does not stop it —
 * the parts-pressure checks measured 7,493 ms median and 297,721 ms worst on a
 * 26.7 server with 3,600 `PostgreSQL`-engine tables. The fix is one shared
 * fragment (`@/lib/clickhouse-local-databases`), and it is easy to forget in the
 * next query added here.
 *
 * Two layers, because they fail differently:
 *  1. Every exported SQL builder in the health query files is rendered and the
 *     rendered text is checked — catches a builder that lost the filter.
 *  2. Every source file under `lib/health/` is scanned for `system.tables` /
 *     `system.columns` references — catches a *new* query file, which layer 1
 *     cannot see because nothing imports it in a test yet.
 *
 * Comments are stripped before scanning, so documenting `system.tables` in a
 * module docblock does not trip the guard. `system.parts` and
 * `system.part_log` are deliberately not covered: a remote-engine database
 * never has parts on this node, so filtering them would add a sub-select to a
 * scan that is already local.
 */

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasLocalDatabasesFilter,
  LOCAL_DATABASE_ENGINES,
  LOCAL_DATABASES_FILTER,
} from '@/lib/clickhouse-local-databases'
import {
  buildPartsPressureCurrentSql,
  buildPartsPressurePercentSql,
  buildPartsPressureProjectionSql,
} from '@/lib/health/parts-pressure'
import {
  buildTtlPartitionFlaggedCountSql,
  buildTtlPartitionHealthDetailSql,
  buildTtlPartitionInventorySql,
} from '@/lib/health/ttl-partition-sql'
import {
  CLUSTER_COLUMNS_QUERY,
  CLUSTER_TABLES_QUERY,
} from '@/lib/schema-diff/cluster-sql'

// Portable form: `import.meta.dir` is a Bun-only field, and this file is type
// checked by tsconfig.test.json, which does not declare it on ImportMeta.
// Same shape as routes/api/__tests__/hostid-validation-contract.test.ts.
const HEALTH_DIR = dirname(fileURLToPath(import.meta.url))
const LIB_DIR = join(HEALTH_DIR, '..')
const SRC_DIR = join(LIB_DIR, '..')

/**
 * Files outside lib/health/ whose catalog scans are unpinned and must be
 * filtered. Deliberately absent: lib/ai/advisor/tuning/tuning-engine.ts and
 * lib/query-config/explorer/dependencies.ts (pinned to the caller's
 * `database = {database:String}`, so a remote-engine database is listed when
 * the caller asked for it).
 */
const GUARDED_FILES = [
  'lib/api/charts/overview-charts.ts',
  'lib/api/menu-count-registry.ts',
  'routes/api/v1/overview.ts',
  'routes/api/v1/tables/index.ts',
  'lib/query-config/explorer/databases.ts',
  'lib/query-config/declarative/catalog/explorer/databases.ts',
  'lib/schema-diff/cluster-sql.ts',
].map((f) => join(SRC_DIR, f))

/**
 * A scan is safe when it is restricted to local engines, or pinned to one
 * literal database. `database = 'system'` is the second case: ClickHouse
 * reserves the `system` name, so no remote-engine database can answer for it.
 */
const PINNED_DATABASE_RE = /\bdatabase\s*=\s*'[a-z_]+'/i

/**
 * The guard reads source, not rendered SQL, so it has to recognise the
 * interpolation as well as the expanded text. A query that interpolates the
 * shared fragment is guarded by construction — it cannot drift away from the
 * engine list — which is why this counts as safe and not as a special case.
 */
const FILTER_INTERPOLATION_RE = /\$\{\s*LOCAL_DATABASES_FILTER\s*\}/

/**
 * Strip comments so a `system.tables` mentioned in prose cannot trip the
 * guard. Block comments first (they can contain `//`), then line comments.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** Every `FROM` / `JOIN` reference to a catalog table, in source order. */
const SCAN_RE = /\b(?:FROM|JOIN)\s+system\.(?:tables|columns)\b/gi

/**
 * Return the text of each catalog scan: from the match up to the next scan, or
 * the end of the file. Windowing on the next scan keeps one filtered query from
 * vouching for an unfiltered one that follows it.
 */
function catalogScans(source: string): string[] {
  const matches = [...source.matchAll(SCAN_RE)]
  return matches.map((match, i) => {
    const end = matches[i + 1]?.index ?? source.length
    return source.slice(match.index, end)
  })
}

/** Whether one scan — rendered or source — is restricted to local engines. */
function restrictsToLocalDatabases(scan: string): boolean {
  return hasLocalDatabasesFilter(scan) || FILTER_INTERPOLATION_RE.test(scan)
}

/** Sources that reference a catalog table without restricting or pinning it. */
function unguardedScans(source: string): string[] {
  return catalogScans(stripComments(source)).filter(
    (scan) => !restrictsToLocalDatabases(scan) && !PINNED_DATABASE_RE.test(scan)
  )
}

/** Every non-test `.ts` file under `lib/health/`, recursively. */
function healthSourceFiles(dir: string = HEALTH_DIR): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...healthSourceFiles(path))
      continue
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

describe('LOCAL_DATABASE_ENGINES allow-list', () => {
  test('every engine is one ClickHouse really registers as a database engine', () => {
    // Guards against a typo or a paste from a table-engine list. `Memory` and
    // `Lazy` are deliberately present even though a later version drops `Lazy`:
    // an engine name that matches nothing is harmless, a missing one is not.
    const engines = new Set(LOCAL_DATABASE_ENGINES)
    expect(engines.has('Atomic')).toBe(true)
    expect(engines.has('Memory')).toBe(true)
    expect([...engines].every((e) => /^[A-Z][A-Za-z]*$/.test(e))).toBe(true)
    expect([...engines]).toEqual([...engines].sort())
  })

  test('excludes every remote database engine it can name', () => {
    const engines: string[] = [...LOCAL_DATABASE_ENGINES]
    for (const remote of [
      'PostgreSQL',
      'MySQL',
      'MaterializedPostgreSQL',
      'MaterializedMySQL',
      'SQLite',
      'S3',
      'HDFS',
      'Filesystem',
      'Dictionary',
      'Overlay',
    ]) {
      expect(engines).not.toContain(remote)
    }
  })

  test('renders a sub-select on system.databases, not a hardcoded list', () => {
    // Resolving system.databases is local metadata and stays cheap; inlining the
    // database names would go stale the moment a database is renamed.
    expect(LOCAL_DATABASES_FILTER).toMatch(
      /^database IN \(SELECT name FROM system\.databases WHERE engine IN \(.+\)\)$/
    )
    for (const engine of LOCAL_DATABASE_ENGINES) {
      expect(LOCAL_DATABASES_FILTER).toContain(`'${engine}'`)
    }
  })
})

describe('health SQL builders restrict catalog scans to local engines', () => {
  const builders: Array<[string, () => string]> = [
    ['buildPartsPressurePercentSql', buildPartsPressurePercentSql],
    [
      'buildPartsPressureProjectionSql',
      () => buildPartsPressureProjectionSql(),
    ],
    ['buildPartsPressureCurrentSql', buildPartsPressureCurrentSql],
    ['buildTtlPartitionInventorySql', () => buildTtlPartitionInventorySql()],
    [
      'buildTtlPartitionFlaggedCountSql',
      () => buildTtlPartitionFlaggedCountSql(),
    ],
    [
      'buildTtlPartitionHealthDetailSql',
      () => buildTtlPartitionHealthDetailSql(),
    ],
  ]

  for (const [name, build] of builders) {
    test(`${name} carries the local-engine filter`, () => {
      const sql = build()
      expect(sql).toContain('system.tables')
      expect(hasLocalDatabasesFilter(sql)).toBe(true)
    })
  }
})

describe('lib/health source guard', () => {
  test('the guard sees the catalog scans it is meant to see', () => {
    // If this ever fails, the scanner stopped matching and every test below it
    // would pass vacuously.
    const scans = catalogScans(
      stripComments(readFileSync(join(HEALTH_DIR, 'parts-pressure.ts'), 'utf8'))
    )
    expect(scans.length).toBeGreaterThan(0)
  })

  test('no health source scans system.tables / system.columns unguarded', () => {
    const offenders: string[] = []
    for (const file of healthSourceFiles()) {
      const unguarded = unguardedScans(readFileSync(file, 'utf8'))
      for (const scan of unguarded) {
        offenders.push(
          `${file.slice(HEALTH_DIR.length + 1)}: ${scan.slice(0, 90)}`
        )
      }
    }
    expect(offenders).toEqual([])
  })

  test('hot-path and explorer catalog scans outside lib/health are guarded', () => {
    const offenders: string[] = []
    for (const file of GUARDED_FILES) {
      for (const scan of unguardedScans(readFileSync(file, 'utf8'))) {
        offenders.push(
          `${file.slice(SRC_DIR.length + 1)}: ${scan.slice(0, 90)}`
        )
      }
    }
    expect(offenders).toEqual([])
  })

  test('cluster diff renders the filter inside the per-node view body', () => {
    for (const sql of [CLUSTER_TABLES_QUERY, CLUSTER_COLUMNS_QUERY]) {
      const view = sql.slice(sql.indexOf('view('))
      expect(view).toContain(LOCAL_DATABASES_FILTER)
    }
  })

  test('a bare system.tables mention in a comment does not fail the guard', () => {
    const prose = `
      /**
       * Reads system.tables + system.parts only.
       * Restricting this to local engines via LOCAL_DATABASES_FILTER.
       */
      export const noop = 'not a query'
    `
    expect(unguardedScans(prose)).toEqual([])
  })

  test('a line comment naming the table does not fail the guard either', () => {
    const lineComment = `
      // Fall back to system.columns when the table is missing.
      export const noop = 'not a query'
    `
    expect(unguardedScans(lineComment)).toEqual([])
  })

  test('an unfiltered catalog scan is caught', () => {
    const bad = `
      const sql = \`
        SELECT name FROM system.tables
        WHERE database NOT IN ('system')
      \`
    `
    expect(unguardedScans(bad)).toHaveLength(1)
  })

  test('the filter can be removed from a real builder and the scan catches it', () => {
    // What the guard would see if someone dropped the fragment from
    // parts-pressure.ts: the same query, minus the one line that filters it.
    const stripped = buildPartsPressureCurrentSql().replace(
      /database IN \(SELECT name FROM system\.databases WHERE engine IN \([^)]*\)\)/,
      '1 = 1'
    )
    expect(stripped).not.toContain('system.databases WHERE engine IN')
    expect(hasLocalDatabasesFilter(stripped)).toBe(false)
    expect(unguardedScans(stripped)).toHaveLength(1)
  })
})
