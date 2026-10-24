import { CLICKHOUSE_KEYWORDS, FALLBACK_FUNCTIONS } from './clickhouse-words'

export interface SqlColumn {
  name: string
  type: string
}

/**
 * What the editor knows about one host, filled lazily. A missing key means
 * "not loaded yet", never "empty": `tables[db]` loads when the user types
 * `db.`, `columns['db.table']` when that table is referenced in FROM/JOIN.
 */
export interface SqlSchema {
  databases: string[]
  tables: Record<string, string[]>
  columns: Record<string, SqlColumn[]>
  /** `system.functions` names; null falls back to the static list. */
  functions: string[] | null
}

export interface TableRef {
  database: string
  table: string
  alias?: string
}

export type CompletionKind =
  | 'keyword'
  | 'function'
  | 'namespace'
  | 'class'
  | 'property'

export interface SqlCompletionOption {
  label: string
  type: CompletionKind
  detail?: string
  boost?: number
}

export interface SqlCompletionResult {
  from: number
  options: SqlCompletionOption[]
  /** Schema pieces the result would include once loaded. */
  missing: { tables: string[]; columns: TableRef[] }
}

export const DEFAULT_DATABASE = 'default'

const IDENT = '[A-Za-z_][A-Za-z0-9_$]*'
const TABLE_CONTEXT_KEYWORDS = new Set([
  'FROM',
  'JOIN',
  'INTO',
  'TABLE',
  'DESCRIBE',
  'DESC',
  'EXISTS',
])
const RESERVED_AFTER_TABLE = new Set([
  'WHERE',
  'PREWHERE',
  'GROUP',
  'ORDER',
  'LIMIT',
  'HAVING',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'ARRAY',
  'GLOBAL',
  'ANY',
  'ALL',
  'ON',
  'USING',
  'FINAL',
  'SAMPLE',
  'SETTINGS',
  'FORMAT',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'WINDOW',
  'QUALIFY',
  'OFFSET',
  'AS',
])

/** Blank out comments and string literals so regexes don't match inside them. */
function maskNonCode(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?(\*\/|$)|'(?:[^'\\]|\\.)*'?/g, (m) =>
    ' '.repeat(m.length)
  )
}

function unquote(name: string): string {
  return name.replace(/[`"]/g, '')
}

/** Tables referenced by FROM / JOIN, with their aliases. */
export function parseTableRefs(
  sql: string,
  defaultDatabase = DEFAULT_DATABASE
): TableRef[] {
  const code = maskNonCode(sql)
  const name = `[\`"]?${IDENT}[\`"]?`
  const re = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(${name}(?:\\.${name})?)(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
    'gi'
  )
  const refs: TableRef[] = []
  for (const m of code.matchAll(re)) {
    const parts = unquote(m[1]).split('.')
    const [database, table] =
      parts.length === 2 ? parts : [defaultDatabase, parts[0]]
    const alias =
      m[2] && !RESERVED_AFTER_TABLE.has(m[2].toUpperCase()) ? m[2] : undefined
    refs.push({ database, table, alias })
  }
  return refs
}

function columnsOf(
  schema: SqlSchema,
  ref: TableRef,
  missing: TableRef[]
): SqlColumn[] {
  const cols = schema.columns[`${ref.database}.${ref.table}`]
  if (!cols) missing.push({ database: ref.database, table: ref.table })
  return cols ?? []
}

function columnOptions(cols: SqlColumn[], boost = 3): SqlCompletionOption[] {
  return cols.map((c) => ({
    label: c.name,
    type: 'property',
    detail: c.type,
    boost,
  }))
}

function tableOptions(
  schema: SqlSchema,
  database: string,
  missingTables: string[]
): SqlCompletionOption[] {
  const tables = schema.tables[database]
  if (!tables) {
    missingTables.push(database)
    return []
  }
  return tables.map((t) => ({ label: t, type: 'class', detail: database }))
}

function dedupe(options: SqlCompletionOption[]): SqlCompletionOption[] {
  const seen = new Set<string>()
  return options.filter((o) => {
    const key = `${o.type}:${o.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Completion options for `doc` with the cursor at `pos`. Returns null when the
 * cursor is not on a word and the caller did not ask explicitly (Ctrl-Space),
 * so typing whitespace or punctuation never pops a list.
 */
export function completeSql(
  doc: string,
  pos: number,
  schema: SqlSchema,
  options: { explicit?: boolean; defaultDatabase?: string } = {}
): SqlCompletionResult | null {
  const defaultDatabase = options.defaultDatabase ?? DEFAULT_DATABASE
  const before = maskNonCode(doc.slice(0, pos))
  // Inside a comment or string: the mask blanked the character at the cursor.
  if (pos > 0 && before[pos - 1] === ' ' && doc[pos - 1] !== ' ') return null

  const word = /[A-Za-z0-9_$]*$/.exec(before)?.[0] ?? ''
  const from = pos - word.length
  const missing = { tables: [] as string[], columns: [] as TableRef[] }
  const refs = parseTableRefs(doc, defaultDatabase)

  // Dotted: `qualifier.` or `db.table.` before the word.
  const dotted = new RegExp(
    `([\`"]?${IDENT}[\`"]?)(?:\\.([\`"]?${IDENT}[\`"]?))?\\.$`
  ).exec(before.slice(0, from))
  if (dotted) {
    const first = unquote(dotted[1])
    const second = dotted[2] ? unquote(dotted[2]) : undefined
    let result: SqlCompletionOption[] = []
    if (second) {
      result = columnOptions(
        columnsOf(schema, { database: first, table: second }, missing.columns)
      )
    } else {
      const byAlias = refs.filter((r) => r.alias === first || r.table === first)
      for (const ref of byAlias)
        result.push(...columnOptions(columnsOf(schema, ref, missing.columns)))
      if (schema.databases.includes(first))
        result.push(...tableOptions(schema, first, missing.tables))
    }
    return { from, options: dedupe(result), missing }
  }

  if (!word && !options.explicit) return null

  const prevKeyword = new RegExp(`(${IDENT})\\s+$`).exec(
    before.slice(0, from)
  )?.[1]
  if (prevKeyword && TABLE_CONTEXT_KEYWORDS.has(prevKeyword.toUpperCase())) {
    const result: SqlCompletionOption[] = [
      ...schema.databases.map((d) => ({
        label: d,
        type: 'namespace' as const,
        boost: 1,
      })),
      ...tableOptions(schema, defaultDatabase, missing.tables).map((o) => ({
        ...o,
        boost: 2,
      })),
    ]
    return { from, options: dedupe(result), missing }
  }

  const result: SqlCompletionOption[] = []
  for (const ref of refs)
    result.push(...columnOptions(columnsOf(schema, ref, missing.columns)))
  for (const ref of refs)
    if (ref.alias) result.push({ label: ref.alias, type: 'class', boost: 2 })
  for (const fn of schema.functions ?? FALLBACK_FUNCTIONS)
    result.push({ label: fn, type: 'function' })
  for (const kw of CLICKHOUSE_KEYWORDS)
    result.push({ label: kw, type: 'keyword', boost: -1 })
  return { from, options: dedupe(result), missing }
}
