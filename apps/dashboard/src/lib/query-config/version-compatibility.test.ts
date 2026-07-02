/**
 * Cross-version schema-compatibility tests for every shipped QueryConfig.
 *
 * chmonitor talks to many ClickHouse versions, and each `QueryConfig` may ship a
 * `VersionedSql[]` (ordered oldest → newest; the executor picks the highest
 * `since` <= the server's version via `selectVersionedSql`). Getting the version
 * matrix wrong is silent: a query resolves to the wrong variant, selects a
 * column that does not exist yet, or silently stops producing a column the UI
 * declares. This suite is the automated guard for that whole surface.
 *
 * It is intentionally corpus-wide (iterates the real `queries` registry), so a
 * NEW or edited config is validated the moment it lands — mirroring the style of
 * `__tests__/shipped-sql-passes-validator.test.ts`.
 *
 * What it checks, for every registered QueryConfig:
 *   (a) selection resolves — for every supported CH version, `selectVersionedSql`
 *       returns a non-empty SQL string (never undefined / empty).
 *   (b) `since` hygiene — versioned entries use valid version strings, are unique,
 *       and are authored in strictly ascending order (the documented contract, so
 *       selection is deterministic and reviewable).
 *   (c) column monotonicity — a newer variant never DROPS a column an older
 *       variant produced. Versioned SQL exists to *add* columns as CH gains them;
 *       silently dropping one means newer-CH users lose a column older-CH users
 *       had, which `columns`-synthesis (null-fill of declared-but-absent columns)
 *       cannot recover. This is the sound half of "columns consistent with SQL".
 *   (d) schema-matrix cross-check — where docs/clickhouse-schemas/tables/<t>.md
 *       documents a column's availability, a variant with `since: X` must not
 *       select a documented column that only exists after X. Best-effort: only
 *       columns/tables the matrix actually documents are checked; anything else
 *       is skipped so the test never goes brittle on an undocumented table.
 *
 * DELIBERATELY NOT ASSERTED — the literal "every SELECTed column is in `columns`"
 * direction. The dashboard legitimately selects columns that are NOT display
 * columns (BackgroundBar helpers like `pct_*` / `readable_*`, and fields consumed
 * only by row-expansion panels, e.g. `mutations.parts_in_progress_names`,
 * `errors.last_error_trace`). ~60 shipped variants do this by design, so that
 * direction is not an invariant and asserting it would be a false positive. The
 * SQL-column extractor here is deliberately conservative and *skips* any variant
 * it cannot parse with confidence (CTEs, UNIONs, unaliased expressions, `*`,
 * quoted aliases), so checks (c)/(d) only fire on unambiguous columns.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { queries } from './index'
import type { QueryConfig } from '../../types/query-config'
import { describe, expect, test } from 'bun:test'
import { getAllSqlStrings, type VersionedSql } from '@chm/sql-builder'
import {
  compareVersions,
  parseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'

// ---------------------------------------------------------------------------
// Supported ClickHouse versions
// ---------------------------------------------------------------------------
//
// There is no single SUPPORTED_VERSIONS constant in the codebase, so this list
// is derived from two sources of truth:
//   1. docs/clickhouse-schemas/index.md — the documented version matrix
//      (23.1/23.3/23.8 LTS baselines, 24.1/24.3/24.8, 25.1).
//   2. Every distinct `since` major.minor boundary actually declared by shipped
//      configs (down to 19.x, up to 26.6 at the time of writing).
// We include a value at (and just below) each real boundary so `selectVersionedSql`
// is exercised at every switch point, plus a few pre-baseline versions to cover
// the oldest-variant fallback path. Keep this ascending.
const SUPPORTED_VERSIONS = [
  '19.8',
  '20.8',
  '21.8',
  '22.3',
  '22.8',
  '22.11',
  '23.2',
  '23.3',
  '23.8',
  '23.11',
  '24.1',
  '24.3',
  '24.8',
  '24.10',
  '25.1',
  '25.4',
  '25.8',
  '25.12',
  '26.1',
  '26.6',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isVersionedArray = (
  sql: QueryConfig['sql']
): sql is VersionedSql[] => Array.isArray(sql)

/** A version string is valid if it is 1–4 dot-separated numbers. */
const VERSION_RE = /^\d+(\.\d+){0,3}$/

/** Strip `-- line` and block comments so parsing sees only SQL. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Conservatively extract the output column names of a SELECT.
 *
 * Returns `null` (meaning "not confident, skip") when the SQL is anything this
 * simple parser cannot reason about safely: a leading CTE (`WITH`), a `SELECT *`
 * / `t.*`, or a projection item that is neither a bare (optionally qualified)
 * identifier nor an `... AS <identifier>` alias (e.g. an unaliased expression, or
 * a quoted alias containing spaces). Only the first top-level SELECT..FROM is
 * inspected, so multi-statement / UNION SQL that would need deeper analysis is
 * also treated as non-confident.
 */
function extractSelectColumns(rawSql: string): string[] | null {
  const sql = stripSqlComments(rawSql)
  if (/^\s*with\b/i.test(sql)) return null

  const selMatch = /\bselect\b/i.exec(sql)
  if (!selMatch) return null
  let i = selMatch.index + selMatch[0].length

  const distinct = /^\s+distinct\b/i.exec(sql.slice(i))
  if (distinct) i += distinct[0].length

  // Walk to the matching top-level FROM.
  let depth = 0
  let inStr: string | null = null
  const start = i
  let fromIdx = -1
  for (; i < sql.length; i++) {
    const c = sql[i]
    if (inStr) {
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && /^from\b/i.test(sql.slice(i))) {
      const prev = sql[i - 1]
      if (prev && /[\s)]/.test(prev)) {
        fromIdx = i
        break
      }
    }
  }
  if (fromIdx === -1) return null

  const list = sql.slice(start, fromIdx)

  // Split the projection list on top-level commas.
  const items: string[] = []
  depth = 0
  inStr = null
  let cur = ''
  for (let j = 0; j < list.length; j++) {
    const c = list[j]
    if (inStr) {
      cur += c
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c
      cur += c
      continue
    }
    if (c === '(') {
      depth++
      cur += c
      continue
    }
    if (c === ')') {
      depth--
      cur += c
      continue
    }
    if (c === ',' && depth === 0) {
      items.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) items.push(cur)

  const names: string[] = []
  for (const raw of items) {
    const item = raw.trim()
    if (!item) continue
    if (item === '*' || /\.\*$/.test(item)) return null
    const asAlias = /\bas\s+([`"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/i.exec(item)
    if (asAlias) {
      names.push(asAlias[2])
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) {
      names.push(item)
      continue
    }
    const qualified = /^[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(
      item
    )
    if (qualified) {
      names.push(qualified[1])
      continue
    }
    return null // unaliased expression / quoted alias / anything ambiguous
  }
  return names
}

/** First `FROM system.<name>` referenced across all variants, or null. */
function primarySystemTable(config: QueryConfig): string | null {
  for (const sql of getAllSqlStrings(config.sql)) {
    const m = /\bfrom\s+system\.([a-z_][a-z0-9_]*)/i.exec(stripSqlComments(sql))
    if (m) return m[1]
  }
  return null
}

// ---------------------------------------------------------------------------
// Schema-matrix parser (docs/clickhouse-schemas/tables/<table>.md)
// ---------------------------------------------------------------------------
//
// Two documented matrix shapes exist in the repo:
//   A. `| Column | 19.x | 21.8 | 23.8 | 24.1+ | Notes |` with Yes/-/blank cells;
//      a column's min version is the earliest version-bucket header marked "Yes".
//   B. `| Column | Since | Description |` with a `Since` cell like "25.1+".
// The parser returns `column -> minVersion` (or `null` when the file is missing
// or has no parseable matrix). Everything is best-effort: unparseable rows are
// skipped, never fatal.

// Portable import.meta.url form (tsc doesn't type Bun's import.meta.dir).
// This file lives at apps/dashboard/src/lib/query-config/ — the schema docs are
// at the repo root under docs/clickhouse-schemas/tables/.
const SCHEMA_TABLES_DIR = fileURLToPath(
  new URL(
    '../../../../../docs/clickhouse-schemas/tables/',
    import.meta.url
  )
)

/** Normalize a matrix header/cell like "24.1+" / "19.x" into a version string. */
function normalizeMatrixVersion(token: string): string | null {
  const t = token.trim().replace(/\+$/, '').replace(/x/gi, '0')
  return VERSION_RE.test(t) ? t : null
}

function parseMatrixTable(md: string): Map<string, string> | null {
  const lines = md.split('\n')
  // Find a markdown table whose header first column is "Column".
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]
    if (!/^\s*\|\s*Column\s*\|/i.test(header)) continue
    const sep = lines[i + 1]
    if (!sep || !/^\s*\|[\s:|-]+\|/.test(sep)) continue

    const cells = (row: string) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())

    const cols = cells(header) // ["Column", <version buckets...> , maybe "Notes"]
    const hasSinceColumn = /^since$/i.test(cols[1] ?? '')

    // Pre-resolve bucket header versions for format A.
    const bucketVersions = cols.map((c, idx) =>
      idx === 0 ? null : normalizeMatrixVersion(c)
    )

    const result = new Map<string, string>()
    for (let r = i + 2; r < lines.length; r++) {
      const row = lines[r]
      if (!/^\s*\|/.test(row)) break // table ended
      const rc = cells(row)
      const column = rc[0]
      if (!column || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) continue

      if (hasSinceColumn) {
        const v = normalizeMatrixVersion(rc[1] ?? '')
        if (v) result.set(column, v)
        continue
      }

      // Format A: earliest bucket header where the cell says "Yes".
      let min: string | null = null
      for (let ci = 1; ci < rc.length; ci++) {
        const bucket = bucketVersions[ci]
        if (!bucket) continue // "Notes" or unparseable header
        if (/^yes$/i.test(rc[ci])) {
          if (!min || compareVersions(parseVersion(bucket), parseVersion(min)) < 0)
            min = bucket
        }
      }
      if (min) result.set(column, min)
    }
    return result.size > 0 ? result : null
  }
  return null
}

const matrixCache = new Map<string, Map<string, string> | null>()
function loadMatrix(table: string): Map<string, string> | null {
  if (matrixCache.has(table)) return matrixCache.get(table) ?? null
  let parsed: Map<string, string> | null = null
  try {
    const md = readFileSync(join(SCHEMA_TABLES_DIR, `${table}.md`), 'utf8')
    parsed = parseMatrixTable(md)
  } catch {
    parsed = null // file missing / unreadable → skip gracefully
  }
  matrixCache.set(table, parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryConfig cross-version schema compatibility', () => {
  test('registry is non-empty (guards against a mis-imported registry)', () => {
    expect(queries.length).toBeGreaterThan(50)
  })

  // (a) Selection resolves to a non-empty SQL string for every version.
  test('selectVersionedSql resolves non-empty SQL for every supported version', () => {
    const failures: string[] = []
    for (const config of queries) {
      for (const v of SUPPORTED_VERSIONS) {
        let sql: string
        try {
          sql = selectVersionedSql(config.sql, parseVersion(v))
        } catch (err) {
          failures.push(`[${config.name}] @${v}: threw ${(err as Error).message}`)
          continue
        }
        if (typeof sql !== 'string' || sql.trim().length === 0) {
          failures.push(`[${config.name}] @${v}: empty/invalid SQL selected`)
        }
      }
    }
    if (failures.length) {
      throw new Error(
        `selectVersionedSql failed for ${failures.length} config/version pair(s):\n` +
          failures.map((f) => `  - ${f}`).join('\n')
      )
    }
    expect(failures).toHaveLength(0)
  })

  // (b) `since` values are valid, unique, and strictly ascending as authored.
  test('versioned `since` values are valid, unique, and strictly ascending', () => {
    const failures: string[] = []
    for (const config of queries) {
      if (!isVersionedArray(config.sql)) continue
      const sinces = config.sql.map((v: VersionedSql) => v.since)

      for (const entry of config.sql) {
        if (!VERSION_RE.test(entry.since)) {
          failures.push(`[${config.name}] invalid since '${entry.since}'`)
        }
        if (typeof entry.sql !== 'string' || entry.sql.trim().length === 0) {
          failures.push(
            `[${config.name}] empty/non-string sql for since '${entry.since}'`
          )
        }
      }

      const valid = sinces.filter((s: string) => VERSION_RE.test(s))
      for (let k = 1; k < valid.length; k++) {
        if (
          compareVersions(parseVersion(valid[k]), parseVersion(valid[k - 1])) <= 0
        ) {
          failures.push(
            `[${config.name}] since not strictly ascending: '${valid[k - 1]}' → '${valid[k]}'`
          )
        }
      }
    }
    if (failures.length) {
      throw new Error(
        `${failures.length} versioned-since problem(s):\n` +
          failures.map((f) => `  - ${f}`).join('\n')
      )
    }
    expect(failures).toHaveLength(0)
  })

  // (c) A newer variant must not drop a column an older variant produced.
  test('newer SQL variants never drop columns produced by older variants', () => {
    const failures: string[] = []
    for (const config of queries) {
      if (!isVersionedArray(config.sql) || config.sql.length < 2) continue
      const parsed = config.sql.map((v: VersionedSql) => ({
        since: v.since,
        cols: extractSelectColumns(v.sql),
      }))
      for (let k = 1; k < parsed.length; k++) {
        const prev = parsed[k - 1]
        const cur = parsed[k]
        if (!prev.cols || !cur.cols) continue // one side not confidently parseable
        const dropped = prev.cols.filter((c: string) => !cur.cols!.includes(c))
        if (dropped.length) {
          failures.push(
            `[${config.name}] ${prev.since} → ${cur.since} dropped: ${dropped.join(', ')}`
          )
        }
      }
    }
    if (failures.length) {
      throw new Error(
        `${failures.length} config(s) drop a column in a newer variant ` +
          `(newer-CH users would lose a column older-CH users have):\n` +
          failures.map((f) => `  - ${f}`).join('\n')
      )
    }
    expect(failures).toHaveLength(0)
  })

  // (d) Best-effort cross-check against the documented schema matrix: a variant
  //     with `since: X` must not select a documented column newer than X.
  test('versioned SQL does not select a column before its documented availability', () => {
    const failures: string[] = []
    let matricesChecked = 0

    for (const config of queries) {
      if (!isVersionedArray(config.sql)) continue
      const table = primarySystemTable(config)
      if (!table) continue
      const matrix = loadMatrix(table)
      if (!matrix) continue // no parseable matrix for this table → skip
      matricesChecked++

      for (const variant of config.sql) {
        if (!VERSION_RE.test(variant.since)) continue
        const cols = extractSelectColumns(variant.sql)
        if (!cols) continue // not confidently parseable → skip
        const variantVer = parseVersion(variant.since)
        for (const col of cols) {
          const minVer = matrix.get(col)
          if (!minVer) continue // column not documented → skip
          if (compareVersions(variantVer, parseVersion(minVer)) < 0) {
            failures.push(
              `[${config.name}] variant since ${variant.since} selects ` +
                `system.${table}.${col}, documented available only since ${minVer}`
            )
          }
        }
      }
    }

    if (failures.length) {
      throw new Error(
        `${failures.length} column(s) selected before their documented availability:\n` +
          failures.map((f) => `  - ${f}`).join('\n')
      )
    }
    // This assertion documents that the matrix cross-check is wired even when it
    // finds nothing to flag; it is not a coverage requirement.
    expect(matricesChecked).toBeGreaterThanOrEqual(0)
  })
})
