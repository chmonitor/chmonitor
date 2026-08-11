/**
 * Hand-rolled SQL parsing helpers for the query advisor — pure string →
 * structure functions with no I/O and no dependency on the rest of the
 * advisor (see `../advisor.ts` header for the duplication note this whole
 * `advisor/` tree inherits).
 */

import type {
  ExplainIndexesInfo,
  SkipIndexExplain,
  SqlPredicate,
} from './types'

// ---------------------------------------------------------------------------
// Predicate / clause extraction
// ---------------------------------------------------------------------------

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>=', 'BETWEEN'])
const EQUALITY_OPERATORS = new Set(['=', 'IN'])

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

export function parseExplainIndexes(
  explainLines: string[]
): ExplainIndexesInfo {
  let primaryKey: ExplainIndexesInfo['primaryKey'] = null
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

export function extractReferencedTables(
  sql: string,
  defaultDatabase = 'default'
): Array<{ database: string; table: string; qualifiedName: string }> {
  const tables = new Map<
    string,
    { database: string; table: string; qualifiedName: string }
  >()

  for (const match of sql.matchAll(TABLE_REFERENCE_PATTERN)) {
    const raw = match[1]
    if (!raw || raw.startsWith('(')) continue
    const parts = raw.split('.').map(normalizeIdentifier).filter(Boolean)
    const database = parts.length > 1 ? parts[0] : defaultDatabase
    const table = parts.length > 1 ? parts[1] : parts[0]
    if (!database || !table) continue
    const qualifiedName = `${database}.${table}`
    if (!tables.has(qualifiedName)) {
      tables.set(qualifiedName, { database, table, qualifiedName })
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

export function splitTopLevelAnd(whereBody: string): string[] {
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
    lastIndex = pos + 3
  }
  parts.push(whereBody.slice(lastIndex).trim())

  return parts.filter(Boolean)
}

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
