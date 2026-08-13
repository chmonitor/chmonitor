/**
 * Query advisor — SQL parsing helpers.
 *
 * Best-effort, top-level only (no nested parens/OR handling). Everything here
 * degrades to "nothing extracted" rather than throwing, matching the advisor's
 * "read-only, degrade gracefully" invariant. Pure string → structure functions:
 * no I/O, no dependency on the rest of the advisor.
 */

import type {
  ExplainIndexesInfo,
  PartsStats,
  PrimaryKeyExplain,
  QueryContext,
  ReferencedTable,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
} from './types'

// ---------------------------------------------------------------------------
// Predicate / clause extraction
// ---------------------------------------------------------------------------

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>=', 'BETWEEN'])
const EQUALITY_OPERATORS = new Set(['=', 'IN'])

/**
 * Extract top-level `WHERE`/`AND`-joined predicates as `{ column, operator }`.
 * Deliberately excludes `OR`-joined and `PREWHERE`/`ON` conditions — this
 * engine only reasons about conditions it can confidently attribute to a
 * single column with AND semantics (same scoping as `WHERE_COLUMN_PATTERN` in
 * the dashboard's `agent/tools/sql-analysis.ts`, but this one also captures
 * the operator so callers can tell equality/IN from range).
 */
export function extractPredicates(sql: string): SqlPredicate[] {
  const pattern =
    /\b(?:WHERE|AND)\s+(?:\w+\.)?(`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)\s*(=|!=|<>|<=|>=|<|>|\bIN\b|\bBETWEEN\b|\bLIKE\b|\bILIKE\b)/gi
  const predicates: SqlPredicate[] = []
  for (const match of sql.matchAll(pattern)) {
    const rawColumn = match[1]
    const column = rawColumn.replace(/^[`"]|[`"]$/g, '').trim()
    const operator = match[2].toUpperCase()
    if (!column) continue
    predicates.push({
      column,
      operator,
      isRange: RANGE_OPERATORS.has(operator),
      isEqualityOrIn: EQUALITY_OPERATORS.has(operator),
    })
  }
  return predicates
}

/** Extract a simple comma-separated column list following `GROUP BY` or `ORDER BY`. Expressions (containing `(`) are skipped — conservative to avoid false schema-mismatch positives. */
export function extractClauseColumns(
  sql: string,
  keyword: 'GROUP BY' | 'ORDER BY'
): string[] {
  const stopWords = 'ORDER BY|GROUP BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'
  const re = new RegExp(
    `\\b${keyword}\\b\\s+([\\s\\S]*?)(?=\\b(?:${stopWords})\\b|;|$)`,
    'i'
  )
  const match = sql.match(re)
  if (!match) return []

  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.includes('('))
    .map((part) => part.replace(/\s+(ASC|DESC)$/i, '').trim())
    .map((part) => part.replace(/^[`"]|[`"]$/g, ''))
    .filter(Boolean)
}

/**
 * Parse `EXPLAIN PLAN indexes=1` text output into structured granule/part
 * counts. Best-effort line-scanner (not a real parser) — tolerant of missing
 * sections; returns `primaryKey: null` / `skipIndexes: []` rather than
 * throwing when the shape doesn't match what it expects (degrades
 * gracefully, e.g. non-MergeTree tables or older/newer CH output variants).
 */
export function parseExplainIndexes(
  explainLines: string[]
): ExplainIndexesInfo {
  let primaryKey: PrimaryKeyExplain | null = null
  const skipIndexes: SkipIndexExplain[] = []
  let section: 'none' | 'primaryKey' | 'skip' = 'none'
  let currentSkip: Partial<SkipIndexExplain> | null = null

  const flushSkip = () => {
    if (
      currentSkip &&
      currentSkip.partsTotal !== undefined &&
      currentSkip.granulesTotal !== undefined
    ) {
      skipIndexes.push({
        name: currentSkip.name ?? 'unknown',
        description: currentSkip.description ?? '',
        partsRead: currentSkip.partsRead ?? 0,
        partsTotal: currentSkip.partsTotal,
        granulesRead: currentSkip.granulesRead ?? 0,
        granulesTotal: currentSkip.granulesTotal,
      })
    }
    currentSkip = null
  }

  for (const raw of explainLines) {
    const line = raw.trim()

    if (/^PrimaryKey$/i.test(line)) {
      section = 'primaryKey'
      primaryKey = {
        partsRead: 0,
        partsTotal: 0,
        granulesRead: 0,
        granulesTotal: 0,
      }
      continue
    }
    if (/^Skip$/i.test(line)) {
      flushSkip()
      section = 'skip'
      currentSkip = {}
      continue
    }
    // Any other bare section header (Partition, Condition, Keys, ...) ends
    // the current Skip/PrimaryKey block's field capture but we keep scanning
    // in case Parts/Granules appear a couple of lines later within it.
    const nameMatch = line.match(/^Name:\s*(.+)$/i)
    if (nameMatch && section === 'skip' && currentSkip) {
      currentSkip.name = nameMatch[1].trim()
      continue
    }
    const descMatch = line.match(/^Description:\s*(.+)$/i)
    if (descMatch && section === 'skip' && currentSkip) {
      currentSkip.description = descMatch[1].trim()
      continue
    }
    const partsMatch = line.match(/^Parts:\s*(\d+)\/(\d+)/i)
    if (partsMatch) {
      const partsRead = Number(partsMatch[1])
      const partsTotal = Number(partsMatch[2])
      if (section === 'primaryKey' && primaryKey) {
        primaryKey.partsRead = partsRead
        primaryKey.partsTotal = partsTotal
      } else if (section === 'skip' && currentSkip) {
        currentSkip.partsRead = partsRead
        currentSkip.partsTotal = partsTotal
      }
      continue
    }
    const granulesMatch = line.match(/^Granules:\s*(\d+)\/(\d+)/i)
    if (granulesMatch) {
      const granulesRead = Number(granulesMatch[1])
      const granulesTotal = Number(granulesMatch[2])
      if (section === 'primaryKey' && primaryKey) {
        primaryKey.granulesRead = granulesRead
        primaryKey.granulesTotal = granulesTotal
      } else if (section === 'skip' && currentSkip) {
        currentSkip.granulesRead = granulesRead
        currentSkip.granulesTotal = granulesTotal
      }
    }
  }
  flushSkip()

  return { primaryKey, skipIndexes }
}

// ---------------------------------------------------------------------------
// Identifier / table-reference utilities
// ---------------------------------------------------------------------------

const TABLE_REFERENCE_PATTERN =
  /\b(?:FROM|JOIN)\s+((?:`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))?)/gi

export function stripQuotedIdentifier(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function normalizeIdentifier(value: string): string {
  return stripQuotedIdentifier(value.trim()).replace(/\s+/g, '')
}

/**
 * Extract the real tables a query reads from (`FROM`/`JOIN`), skipping CTE
 * aliases declared by a leading `WITH ... AS (...)` — those are query-local
 * names, not tables the advisor can look up in `system.tables`.
 */
export function extractReferencedTables(
  sql: string,
  defaultDatabase = 'default'
): ReferencedTable[] {
  const tables = new Map<string, ReferencedTable>()

  // Extract CTE names to filter them out later (they're aliases, not real tables)
  const cteNames = new Set<string>()
  const cteMatch = sql.match(/WITH\s+(.+?)\s+AS\s*\(/i)
  if (cteMatch) {
    // Parse CTE definitions: "cte1 AS (...), cte2 AS (...)"
    const cteDefs = cteMatch[1].split(/\),\s*/)
    for (const cteDef of cteDefs) {
      const name = cteDef.trim().split(/\s+/)[0]
      if (name) {
        cteNames.add(normalizeIdentifier(name))
      }
    }
  }

  for (const match of sql.matchAll(TABLE_REFERENCE_PATTERN)) {
    const raw = match[1]
    if (!raw || raw.startsWith('(')) continue

    const parts = raw.split('.').map(normalizeIdentifier).filter(Boolean)
    const database = parts.length > 1 ? parts[0] : defaultDatabase
    const table = parts.length > 1 ? parts[1] : parts[0]
    if (!database || !table) continue

    // Skip if this is a CTE alias (not a real table)
    if (cteNames.has(table)) continue

    const qualifiedName = `${database}.${table}`
    if (!tables.has(qualifiedName)) {
      tables.set(qualifiedName, { raw, database, table, qualifiedName })
    }
  }

  return [...tables.values()]
}

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``
}

export function formatQualifiedTable(database: string, table: string): string {
  return `${quoteIdentifier(database)}.${quoteIdentifier(table)}`
}

// ---------------------------------------------------------------------------
// WHERE-clause splitting (used by the PREWHERE rewriter)
// ---------------------------------------------------------------------------

const CLAUSE_STOP_WORDS =
  'GROUP BY|ORDER BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'

/**
 * Split a WHERE body on top-level `AND` (i.e. not inside parentheses),
 * so a parenthesized `OR` group is kept intact as one condition instead of
 * being incorrectly torn apart. Not a full SQL parser — good enough for the
 * common case; anything it can't confidently segment is left as a single
 * condition (the caller then just won't find its target column in it, and
 * `proposePrewhereRewrite` returns `null` rather than risk a broken rewrite).
 */
export function splitTopLevelAnd(whereBody: string): string[] {
  // Track paren depth per character so an AND inside `(...)` (e.g. a
  // parenthesized OR group) is never treated as a split point.
  const depthAt: number[] = []
  let depth = 0
  for (let i = 0; i < whereBody.length; i++) {
    const ch = whereBody[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    depthAt[i] = depth
  }

  const positions: number[] = []
  const re = /\bAND\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(whereBody)) !== null) {
    if (depthAt[match.index] === 0) positions.push(match.index)
  }

  const parts: string[] = []
  let lastIndex = 0
  for (const pos of positions) {
    parts.push(whereBody.slice(lastIndex, pos).trim())
    lastIndex = pos + 3 // length of "AND"
  }
  parts.push(whereBody.slice(lastIndex).trim())

  return parts.filter(Boolean)
}

/** Locate the WHERE clause span `[start, end)` in `sql` — `start` is the index of the `WHERE` keyword itself. */
export function findWhereSpan(
  sql: string
): { start: number; end: number; body: string } | null {
  const re = new RegExp(
    `\\bWHERE\\b\\s+([\\s\\S]*?)(?=\\b(?:${CLAUSE_STOP_WORDS})\\b|;|$)`,
    'i'
  )
  const match = re.exec(sql)
  if (!match || match.index === undefined) return null
  return {
    start: match.index,
    end: match.index + match[0].length,
    body: match[1].trim(),
  }
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

export interface BuildQueryContextInput {
  sql: string
  database: string
  table: string
  schema: TableSchema
  parts: PartsStats
  explain: ExplainIndexesInfo | null
}

/**
 * Assemble the caller's read-only findings (schema, parts, EXPLAIN) plus the
 * SQL parsed here into the `QueryContext` every scorer consumes. Pure: the
 * caller does the fetching, this only parses and packs.
 */
export function buildQueryContext(input: BuildQueryContextInput): QueryContext {
  const { sql, database, table, schema, parts, explain } = input
  return {
    sql,
    database,
    table,
    predicates: extractPredicates(sql),
    groupByColumns: extractClauseColumns(sql, 'GROUP BY'),
    orderByColumns: extractClauseColumns(sql, 'ORDER BY'),
    hasPrewhere: /\bPREWHERE\b/i.test(sql),
    schema,
    parts,
    explain,
  }
}
