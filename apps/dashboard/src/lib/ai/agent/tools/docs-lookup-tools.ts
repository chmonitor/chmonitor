import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

type SymbolKind =
  | 'function'
  | 'setting'
  | 'merge_tree_setting'
  | 'server_setting'
  | 'metric'
  | 'event'

interface KindSource {
  table: string
  key: string
  columns: readonly string[]
}

// Wanted columns in display order. Each host only gets the subset its
// system.columns reports, so older ClickHouse versions still work.
const SOURCES: Record<SymbolKind, KindSource> = {
  function: {
    table: 'functions',
    key: 'name',
    columns: [
      'name',
      'alias_to',
      'is_aggregate',
      'case_insensitive',
      'categories',
      'introduced_in',
      'syntax',
      'description',
      'arguments',
      'parameters',
      'returned_value',
      'examples',
    ],
  },
  setting: {
    table: 'settings',
    key: 'name',
    columns: [
      'name',
      'type',
      'value',
      'default',
      'changed',
      'tier',
      'is_obsolete',
      'readonly',
      'min',
      'max',
      'alias_for',
      'description',
    ],
  },
  merge_tree_setting: {
    table: 'merge_tree_settings',
    key: 'name',
    columns: [
      'name',
      'type',
      'value',
      'default',
      'changed',
      'tier',
      'is_obsolete',
      'readonly',
      'min',
      'max',
      'description',
    ],
  },
  server_setting: {
    table: 'server_settings',
    key: 'name',
    columns: [
      'name',
      'type',
      'value',
      'default',
      'changed',
      'changeable_without_restart',
      'is_obsolete',
      'description',
    ],
  },
  metric: {
    table: 'metrics',
    key: 'metric',
    columns: ['metric', 'value', 'description'],
  },
  event: {
    table: 'events',
    key: 'event',
    columns: ['event', 'value', 'description'],
  },
}

const MAX_FIELD_CHARS = 1500
const MAX_EXAMPLES_CHARS = 1200
const SEARCH_SUMMARY_CHARS = 160
const SUGGESTION_LIMIT = 5

async function availableColumns(
  table: string,
  hostId: number
): Promise<Set<string>> {
  const rows = (await readOnlyQuery({
    query:
      "SELECT name FROM system.columns WHERE database = 'system' AND table = {table:String}",
    query_params: { table },
    hostId,
    useCache: true,
  })) as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

function truncate(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}… [truncated ${value.length - max} chars]`
    : value
}

/** Drop empty fields and cap long text so one lookup stays a few KB. */
function compact(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === '' || v === null || (Array.isArray(v) && v.length === 0)) continue
    out[k] =
      typeof v === 'string'
        ? truncate(
            v.trim(),
            k === 'examples' ? MAX_EXAMPLES_CHARS : MAX_FIELD_CHARS
          )
        : v
  }
  return out
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`
}

async function lookup(kind: SymbolKind, name: string, hostId: number) {
  const src = SOURCES[kind]
  const available = await availableColumns(src.table, hostId)
  const cols = src.columns.filter((c) => available.has(c))
  if (!available.has(src.key)) {
    return {
      found: false,
      kind,
      name,
      error: `system.${src.table} is not available on this host.`,
    }
  }
  const select = cols.map((c) => `\`${c}\``).join(', ')
  // Exact match first, then a case-insensitive one so `MAX_THREADS` still
  // finds `max_threads`.
  const rows = (await readOnlyQuery({
    query: `SELECT ${select} FROM system.${src.table} WHERE \`${src.key}\` = {name:String} OR lower(\`${src.key}\`) = lower({name:String}) ORDER BY \`${src.key}\` = {name:String} DESC LIMIT 1`,
    query_params: { name },
    hostId,
  })) as Record<string, unknown>[]

  if (rows.length > 0) return { found: true, kind, entry: compact(rows[0]) }

  const suggestions = (await readOnlyQuery({
    query: `SELECT \`${src.key}\` AS name FROM system.${src.table} WHERE \`${src.key}\` ILIKE {pattern:String} ORDER BY length(\`${src.key}\`) LIMIT ${SUGGESTION_LIMIT}`,
    query_params: { pattern: likePattern(name) },
    hostId,
  })) as { name: string }[]
  return {
    found: false,
    kind,
    name,
    suggestions: suggestions.map((s) => s.name),
    hint:
      kind === 'event'
        ? // system_events_show_zero_values cannot be set under readonly=1.
          `No event named "${name}" with a non-zero count on this host. system.events hides events that have not fired yet, so it may still exist.`
        : `No ${kind} named "${name}" on this host's ClickHouse version. Try kind "search".`,
  }
}

async function search(term: string, limit: number, hostId: number) {
  const branches: string[] = []
  for (const [kind, table] of [
    ['function', 'functions'],
    ['setting', 'settings'],
  ] as const) {
    const available = await availableColumns(table, hostId)
    const hasDesc = available.has('description')
    const where = hasDesc
      ? 'name ILIKE {pattern:String} OR description ILIKE {pattern:String}'
      : 'name ILIKE {pattern:String}'
    const summary = hasDesc
      ? `substring(trimBoth(description), 1, ${SEARCH_SUMMARY_CHARS})`
      : "''"
    branches.push(
      `SELECT '${kind}' AS kind, name, ${summary} AS summary FROM system.${table} WHERE ${where}`
    )
  }
  // Name hits rank above description-only hits, shorter names first.
  const rows = (await readOnlyQuery({
    query: `SELECT kind, name, summary FROM (${branches.join(' UNION ALL ')}) ORDER BY positionCaseInsensitive(name, {term:String}) = 0, length(name), name LIMIT {limit:UInt32}`,
    query_params: { pattern: likePattern(term), term, limit },
    hostId,
  })) as Record<string, unknown>[]
  return { query: term, count: rows.length, results: rows.map(compact) }
}

export function createDocsLookupTools(hostId: number) {
  return {
    explain_clickhouse_symbol: dynamicTool({
      description:
        "Read ClickHouse's built-in docs from the user's own server, so the answer matches their version. Looks up a function (syntax, arguments, examples, introduced_in), a session setting or MergeTree setting (type, default, current value, tier), a server setting, or a metric/event description. Use kind 'search' to find names by keyword across functions and settings. Not found means the symbol does not exist on this version.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe(
            "Exact symbol name (e.g. 'toStartOfInterval', 'max_threads'), or a keyword when kind is 'search'"
          ),
        kind: z
          .enum([
            'function',
            'setting',
            'merge_tree_setting',
            'server_setting',
            'metric',
            'event',
            'search',
          ])
          .describe('What kind of symbol to look up'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Max results for kind 'search' (default 20)"),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          name,
          kind,
          limit = 20,
          hostId: toolHostId,
        } = input as {
          name: string
          kind: SymbolKind | 'search'
          limit?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const term = name.trim()
        if (kind === 'search')
          return search(term, Math.min(Math.max(limit, 1), 50), resolvedHostId)
        return lookup(kind, term, resolvedHostId)
      },
    }),
  }
}
