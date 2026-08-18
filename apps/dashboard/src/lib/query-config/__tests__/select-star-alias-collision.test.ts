/**
 * Corpus-wide guard against the `SELECT *` + colliding-alias bug (merges, #3029).
 *
 * `SELECT *, database || '.' || table AS table FROM system.merges` declares the
 * `table` column TWICE: once from the star, once from the alias. What ClickHouse
 * does with that depends on the analyzer, and neither outcome is what the config
 * author intended (both verified on a live server):
 *
 *   enable_analyzer=1 (default)  the star's column is renamed to the qualified
 *                                `merges.table`, so the response carries an extra
 *                                junk column the UI never declared;
 *   enable_analyzer=0 (legacy)   the response carries the key `table` twice — a
 *                                malformed payload whose meaning depends on which
 *                                duplicate the parser keeps.
 *
 * Constant-folded shapes reject outright with
 * `Code: 352 AMBIGUOUS_COLUMN_NAME: Block structure mismatch`.
 *
 * NOTE, so this comment does not overstate its case: this is a latent
 * output-shape defect, NOT the cause of the "No data available" report that led
 * to it. `system.merges` only lists merges in flight, so an idle cluster is
 * legitimately empty — see the `suggestion` on `mergesConfig`.
 *
 * It was invisible to the rest of the suite: `version-compatibility.test.ts`
 * deliberately SKIPS any variant it cannot parse with confidence, and `*` is on
 * its skip list. So the broken config passed all 1157 tests for as long as it
 * shipped. This file closes that hole for the whole `queries` registry, not just
 * for merges.
 *
 * The rule, stated so it stays sound rather than merely strict: inside a select
 * list containing a bare `*`, flag an alias only when its own defining
 * expression READS a column of that name — `database || '.' || table AS table`
 * reads `table` to build `table`. That self-reference proves `table` is a real
 * column of the FROM relation, so the star already emits it and the alias
 * duplicates it.
 *
 * Deliberately NOT flagged, because neither is a collision:
 *   - an alias merely referenced by a LATER expression, e.g.
 *     `round(progress * 100, 1) AS pct_progress, cast(pct_progress, 'String')`
 *     — `pct_progress` is computed here, not read from the table;
 *   - an alias over a fresh name, e.g. `(database || '.' || table) AS
 *     database_table` (`replicas` ships this);
 *   - an alias whose column the star explicitly drops via `* EXCEPT (col)`
 *     (`replication-queue` ships this — it is the sanctioned fix).
 */

import type { QueryConfig } from '../../../types/query-config'

import { queries } from '../index'
import { describe, expect, test } from 'bun:test'

/** SQL keywords / function names that must never count as "a column read". */
const NOT_A_COLUMN = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'as',
  'case',
  'when',
  'then',
  'else',
  'end',
  'over',
  'order',
  'by',
  'group',
  'having',
  'limit',
  'desc',
  'asc',
  'null',
  'if',
  'distinct',
  'partition',
  'on',
  'join',
  'union',
  'all',
  'interval',
])

interface Variant {
  configName: string
  since: string
  sql: string
}

function variantsOf(config: QueryConfig): Variant[] {
  const { sql } = config
  if (typeof sql === 'string') {
    return [{ configName: config.name, since: '-', sql }]
  }
  return sql.map((v) => ({
    configName: config.name,
    since: v.since,
    sql: v.sql,
  }))
}

/**
 * The select list of the OUTERMOST query: everything between the leading
 * `SELECT` and its matching `FROM` at paren depth 0. Returns null when the SQL
 * does not start with a plain `SELECT` (CTEs, subquery-first forms) — those are
 * out of scope rather than silently mis-parsed.
 */
function outerSelectList(sql: string): string | null {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  const start = stripped.search(/\bSELECT\b/i)
  if (start === -1) return null
  // Anything other than whitespace before the first SELECT (a WITH clause, an
  // opening paren) means this is not a simple outer select — skip.
  if (stripped.slice(0, start).trim() !== '') return null

  let depth = 0
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && /\s/.test(ch)) {
      const rest = stripped.slice(i + 1)
      const m = rest.match(/^FROM\b/i)
      if (m) return stripped.slice(start + 'SELECT'.length, i)
    }
  }
  return null
}

/** True when the select list contains a bare `*` (not `count(*)`, not `t.*`). */
function hasBareStar(selectList: string): boolean {
  // Drop parenthesised groups so `count(*)` / `max(x) OVER ()` cannot match.
  let depth = 0
  let flat = ''
  for (const ch of selectList) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0) flat += ch
  }
  return /(^|,)\s*\*/.test(flat)
}

/**
 * Split a select list into top-level items (commas at paren depth 0), so each
 * alias can be examined against ITS OWN defining expression.
 */
function topLevelItems(selectList: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  let inString = false
  for (let i = 0; i < selectList.length; i++) {
    const ch = selectList[i]
    if (inString) {
      current += ch
      if (ch === "'" && selectList[i - 1] !== '\\') inString = false
      continue
    }
    if (ch === "'") {
      inString = true
      current += ch
    } else if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) items.push(current)
  return items
}

/** Bare identifiers an expression reads (function names and keywords excluded). */
function identifiersRead(expression: string): Set<string> {
  const withoutStrings = expression.replace(/'(?:[^'\\]|\\.)*'/g, ' ')
  const out = new Set<string>()
  for (const m of withoutStrings.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)) {
    const word = m[0]
    // A name immediately followed by `(` is a function call, not a column.
    if (/^\s*\(/.test(withoutStrings.slice(m.index + word.length))) continue
    if (NOT_A_COLUMN.has(word.toLowerCase())) continue
    out.add(word)
  }
  return out
}

/**
 * Columns the star explicitly drops: `SELECT * EXCEPT (table, parts_to_merge)`.
 * Re-aliasing one of these is the CORRECT fix for the collision, not the bug —
 * `replication-queue` already does it — so they must never be reported.
 */
function starExcepts(selectList: string): Set<string> {
  const out = new Set<string>()
  for (const m of selectList.matchAll(/\*\s*EXCEPT\s*\(([^)]*)\)/gi)) {
    for (const name of m[1].split(',')) {
      const trimmed = name.trim()
      if (trimmed) out.add(trimmed)
    }
  }
  return out
}

function collisionsFor(variant: Variant): string[] {
  const selectList = outerSelectList(variant.sql)
  if (!selectList || !hasBareStar(selectList)) return []
  const excepted = starExcepts(selectList)

  const offenders: string[] = []
  for (const item of topLevelItems(selectList)) {
    const alias = item.match(/\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/i)?.[1]
    if (!alias || excepted.has(alias)) continue
    // The alias's own defining expression, with the `AS <alias>` tail removed.
    const expression = item.replace(/\bAS\s+[a-zA-Z_][a-zA-Z0-9_]*\s*$/i, ' ')
    if (identifiersRead(expression).has(alias)) offenders.push(alias)
  }
  return offenders
}

describe('SELECT * must not collide with an alias of the same name', () => {
  const allVariants = Object.values(queries).flatMap((config) =>
    variantsOf(config as QueryConfig)
  )

  test('the registry ships no colliding alias', () => {
    const offenders = allVariants.flatMap((v) =>
      collisionsFor(v).map(
        (alias) =>
          `${v.configName} (since ${v.since}): \`SELECT *\` already emits \`${alias}\`, but an alias re-declares it`
      )
    )
    expect(offenders).toEqual([])
  })

  // The detector is only worth having if it actually fires on the shape that
  // shipped broken. Pin it against the exact pre-fix merges SQL.
  test('detects the merges bug this guard was written for', () => {
    const preFix: Variant = {
      configName: 'merges (pre-fix)',
      since: '19.1',
      sql: `
        SELECT *,
          database || '.' || table as table,
          round(progress * 100, 1) as pct_progress
        FROM system.merges
        ORDER BY progress DESC
      `,
    }
    expect(collisionsFor(preFix)).toEqual(['table'])
  })

  // `* EXCEPT (col)` is the sanctioned way to re-alias a starred column
  // (replication-queue ships it); the guard must not report it.
  test('allows an alias whose column the star drops via EXCEPT', () => {
    const ok: Variant = {
      configName: 'replication-queue',
      since: '-',
      sql: `
        SELECT
          * EXCEPT (table, parts_to_merge),
          concat(database, '.', table) AS table,
          arrayStringConcat(parts_to_merge, ', ') AS parts_to_merge
        FROM system.replication_queue
      `,
    }
    expect(collisionsFor(ok)).toEqual([])
  })

  // ...and must stay quiet on the legitimate non-colliding form.
  test('allows an alias no other expression reads', () => {
    const ok: Variant = {
      configName: 'replicas',
      since: '-',
      sql: `
        SELECT *, (database || '.' || table) as database_table
        FROM system.replicas
      `,
    }
    expect(collisionsFor(ok)).toEqual([])
  })
})
