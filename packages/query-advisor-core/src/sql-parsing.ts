/** Best-effort, top-level-only parsing. Everything degrades to "nothing extracted" rather than throwing. */

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

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>=', 'BETWEEN'])
const EQUALITY_OPERATORS = new Set(['=', 'IN'])

/**
 * Excludes `OR`-joined and `PREWHERE`/`ON` conditions: only predicates
 * attributable to one column with AND semantics. Captures the operator so
 * callers can tell equality/IN from range.
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
 * Line-scanner for `EXPLAIN PLAN indexes=1`. Returns `primaryKey: null` /
 * `skipIndexes: []` on unexpected shapes (non-MergeTree, other CH versions).
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

/** Skips CTE aliases: query-local names that are not in `system.tables`. */
export function extractReferencedTables(
  sql: string,
  defaultDatabase = 'default'
): ReferencedTable[] {
  const tables = new Map<string, ReferencedTable>()

  const cteNames = new Set<string>()
  const cteMatch = sql.match(/WITH\s+(.+?)\s+AS\s*\(/i)
  if (cteMatch) {
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

const CLAUSE_STOP_WORDS =
  'GROUP BY|ORDER BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'

/**
 * Splits on top-level `AND` so a parenthesized `OR` group stays intact. Anything
 * it can't segment stays one condition, and `proposePrewhereRewrite` then
 * returns `null` rather than risk a broken rewrite.
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

/** `start` is the index of the `WHERE` keyword itself. */
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

export interface BuildQueryContextInput {
  sql: string
  database: string
  table: string
  schema: TableSchema
  parts: PartsStats
  explain: ExplainIndexesInfo | null
}

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
