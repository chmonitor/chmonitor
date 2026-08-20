/**
 * Sync pretty-printer for ClickHouse CREATE TABLE DDL.
 *
 * Schema Compare shows catalog `create_table_query` values, which ClickHouse
 * returns as a single dense line. sql-formatter is async and ~484K; this
 * path is deterministic for the CREATE TABLE shape we actually diff.
 */

const TABLE_ATTRS = [
  'PARTITION BY',
  'PRIMARY KEY',
  'ORDER BY',
  'SAMPLE BY',
  'ENGINE',
  'SETTINGS',
  'COMMENT',
  'TTL',
] as const

const CREATE_TABLE_HEAD = /^CREATE\s+(OR\s+REPLACE\s+)?(TEMPORARY\s+)?TABLE\b/i

export function prettySchemaSql(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return sql
  if (!CREATE_TABLE_HEAD.test(trimmed)) return trimmed

  const columnList = findColumnList(trimmed)
  if (!columnList) return trimmed

  const { header, inner, tail } = columnList
  const columns = splitTopLevel(inner, ',').map((part) => part.trim())
  const attrs = splitTableAttrs(tail.trim())

  const colBlock =
    columns.length === 0
      ? '()'
      : `(\n${columns.map((col) => `  ${col}`).join(',\n')}\n)`

  const attrBlock = attrs.length > 0 ? `\n${attrs.join('\n')}` : ''
  return `${header.trimEnd()}\n${colBlock}${attrBlock}`
}

function findColumnList(
  sql: string
): { header: string; inner: string; tail: string } | null {
  const open = findColumnListOpen(sql)
  if (open < 0) return null
  const close = matchingParen(sql, open)
  if (close < 0) return null
  return {
    header: sql.slice(0, open),
    inner: sql.slice(open + 1, close),
    tail: sql.slice(close + 1),
  }
}

/** First `(` that opens the column/index list, not a type argument. */
function findColumnListOpen(sql: string): number {
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i)
      continue
    }
    if (ch === '(') return i
    i += 1
  }
  return -1
}

function matchingParen(sql: string, open: number): number {
  let depth = 0
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i)
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function skipQuoted(sql: string, start: number): number {
  const quote = sql[start]
  let i = start + 1
  while (i < sql.length) {
    if (quote === "'" && sql[i] === '\\') {
      i += 2
      continue
    }
    if (sql[i] === quote) {
      if (quote === "'" && sql[i + 1] === "'") {
        i += 2
        continue
      }
      return i
    }
    i += 1
  }
  return sql.length - 1
}

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(input, i)
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === sep && depth === 0) {
      parts.push(input.slice(start, i))
      start = i + sep.length
    }
  }
  parts.push(input.slice(start))
  return parts
}

function splitTableAttrs(tail: string): string[] {
  if (!tail) return []
  const hits: { index: number; keyword: string }[] = []
  const upper = tail.toUpperCase()
  for (const keyword of TABLE_ATTRS) {
    let from = 0
    while (from < tail.length) {
      const index = indexOfKeyword(upper, keyword, from)
      if (index < 0) break
      if (isTopLevelAt(tail, index)) hits.push({ index, keyword })
      from = index + keyword.length
    }
  }
  hits.sort((a, b) => a.index - b.index || b.keyword.length - a.keyword.length)

  const deduped: { index: number; keyword: string }[] = []
  for (const hit of hits) {
    const prev = deduped[deduped.length - 1]
    if (prev && hit.index === prev.index) continue
    if (prev && hit.index < prev.index + prev.keyword.length) continue
    deduped.push(hit)
  }

  if (deduped.length === 0) return [collapseWs(tail)]

  const lines: string[] = []
  if (deduped[0].index > 0) {
    const prefix = collapseWs(tail.slice(0, deduped[0].index))
    if (prefix) lines.push(prefix)
  }
  for (let i = 0; i < deduped.length; i += 1) {
    const from = deduped[i].index
    const to = i + 1 < deduped.length ? deduped[i + 1].index : tail.length
    lines.push(collapseWs(tail.slice(from, to)))
  }
  return lines.filter(Boolean)
}

function indexOfKeyword(upper: string, keyword: string, from: number): number {
  let index = upper.indexOf(keyword, from)
  while (index >= 0) {
    const before = index === 0 ? ' ' : upper[index - 1]
    const after = upper[index + keyword.length] ?? ' '
    if (isBoundary(before) && isBoundary(after)) return index
    index = upper.indexOf(keyword, index + keyword.length)
  }
  return -1
}

function isBoundary(ch: string): boolean {
  return /[\s=(),]/.test(ch)
}

function isTopLevelAt(sql: string, index: number): boolean {
  let depth = 0
  for (let i = 0; i < index; i += 1) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i)
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
  }
  return depth === 0
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
