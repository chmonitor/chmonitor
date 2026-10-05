/**
 * Anti-shadowing guard for aggregate aliases that reuse a source column name.
 * Rejects the two shapes that raise `Code: 184 ILLEGAL_AGGREGATION` on the
 * analyzer that has been the default since 24.3:
 *
 *   1. WHERE reads the bare name      -> `any(query) AS query` + `WHERE query …`
 *   2. another aggregate wraps it     -> `sum(read_rows) AS read_rows` +
 *                                         `formatReadableQuantity(sum(read_rows))`
 *
 * Every shape below was verified FAIL/ok on real ClickHouse 24.3 and 26.7.
 */

import type { HistoryPickerFilters } from '@/lib/ai/advisor/history-picker'
import type { ChartQueryBuilder } from '@/types/chart-data'
import type { QueryConfig } from '../../../types/query-config'

import { queries } from '../index'
import { describe, expect, test } from 'bun:test'
import { buildHistoryPickerQuery } from '@/lib/ai/advisor/history-picker'
import { queryCharts } from '@/lib/api/charts/query-charts'
import { queryInsightsCharts } from '@/lib/api/charts/query-insights-charts'
import { queryPerfCharts } from '@/lib/api/charts/query-perf-charts'

// ---------------------------------------------------------------------------
// Columns of the tables this guard knows about. Deliberately an explicit
// allowlist: a false "this is a column" claim would invent violations, and
// these three tables carry every shape found in the repo.
// ---------------------------------------------------------------------------

const SYSTEM_QUERY_LOG_COLUMNS = new Set([
  'type',
  'event_date',
  'event_time',
  'event_time_microseconds',
  'query_start_time',
  'query_start_time_microseconds',
  'query_duration_ms',
  'read_rows',
  'read_bytes',
  'written_rows',
  'written_bytes',
  'result_rows',
  'result_bytes',
  'memory_usage',
  'query',
  'query_id',
  'normalized_query_hash',
  'normalized_query',
  'user',
  'current_database',
  'query_kind',
  'client_name',
  'client_version',
  'exception',
  'exception_code',
  'tables',
  'columns',
  'databases',
  'ProfileEvents',
  'query_cache_usage',
  'Settings',
  'databases',
  'used_tables',
  'thread_ids',
  'log_comment',
  'initial_query_start_time',
  'initial_query_id',
  'is_initial_query',
  'is_redo',
  'query_views_log',
  'SettingsMap',
])

const SYSTEM_PARTS_COLUMNS = new Set([
  'partition',
  'name',
  'uuid',
  'part_type',
  'active',
  'marks',
  'rows',
  'bytes_on_disk',
  'data_compressed_bytes',
  'data_uncompressed_bytes',
  'primary_key_bytes_in_memory',
  'primary_key_bytes_in_memory_allocated',
  'database',
  'table',
  'engine',
  'disk_name',
  'path',
  'hash_of_all_files',
  'hash_of_uncompressed_files',
  'level',
  'data_version',
  'min_date',
  'max_date',
  'min_time',
  'max_time',
  'delete_ttl_info_min',
  'delete_ttl_info_max',
  'move_ttl_info.expression',
  'move_ttl_info.min',
  'move_ttl_info.max',
  'rows_where_ttl_info.expression',
  'rows_where_ttl_info.min',
  'rows_where_ttl_info.max',
  'bytes_where_ttl_info.expression',
  'bytes_where_ttl_info.min',
  'bytes_where_ttl_info.max',
  'recording_ttl_info.expression',
  'recording_ttl_info.min',
  'recording_ttl_info.max',
  'storage_policy',
])

const SYSTEM_PROCESSES_COLUMNS = new Set([
  'elapsed',
  'read_rows',
  'read_bytes',
  'written_rows',
  'written_bytes',
  'memory_usage',
  'peak_memory_usage',
  'total_memory_profiled',
  'query',
  'query_id',
  'user',
  'current_database',
  'initial_query_start_time',
  'query_start_time',
  'query_kind',
  'interface',
  'client_name',
  'client_version',
  'OSUser',
  'OSThreadId',
  'ProfileEvents',
  'Settings',
  'limit_usage',
])

const SYSTEM_QUERY_METRIC_LOG_COLUMNS = new Set([
  'event_date',
  'event_time',
  'event_time_microseconds',
  'query_start_time',
  'query_id',
  'memory_usage',
  'peak_memory_usage',
  'current_database',
  'user',
  'query',
  'ProfileEvents',
])

const TABLE_COLUMNS: Record<string, Set<string>> = {
  'system.query_log': SYSTEM_QUERY_LOG_COLUMNS,
  'system.parts': SYSTEM_PARTS_COLUMNS,
  'system.processes': SYSTEM_PROCESSES_COLUMNS,
  'system.query_metric_log': SYSTEM_QUERY_METRIC_LOG_COLUMNS,
}

/**
 * The table ONE select scope reads from, following a CTE name to the table
 * that CTE selects from. The `FROM` is taken at paren depth 0, so a
 * nested subquery's own `FROM system.parts` is never attributed to the outer
 * scope. `FROM merge('system', '^query_log')` names the same table through a
 * pattern, so it resolves to `system.query_log`.
 */
/**
 * `name -> underlying table` for every CTE in the statement, so a scope that
 * reads `FROM filtered` is checked against the table `filtered` selects from.
 * Without this the guard would be blind to every CTE-based query — which is
 * exactly where both shipped bugs live.
 */
function sourceTable(tail: string, ctes: Map<string, string>): string | null {
  const fromIndex = ownFromIndex(tail)
  if (fromIndex === -1) return null
  return baseTable(tail.slice(fromIndex), ctes)
}

function cteTables(sql: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of sql.matchAll(/(?:^|[\s,)])([A-Za-z_]\w*)\s+AS\s*\(/gi)) {
    const body = m[0]
    if (
      !/\bWITH\b/i.test(
        sql.slice(Math.max(0, m.index - 40), m.index + m[1].length)
      )
    ) {
      continue
    }
    const after = sql.slice(m.index)
    const open = after.indexOf('(')
    let depth = 0
    let close = -1
    for (let i = open; i < after.length; i++) {
      if (after[i] === '(') depth++
      else if (after[i] === ')') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close === -1) continue
    const table = baseTable(after.slice(open, close), map)
    if (table) map.set(m[1], table)
    void body
  }
  return map
}

/** The table `sql` reads directly, following one level of CTE indirection. */
function baseTable(sql: string, ctes: Map<string, string>): string | null {
  const scrubbed = scrub(sql)
  const merged = scrubbed.match(
    /\bFROM\s+merge\(\s*'system'\s*,\s*'\^(\w+)'\s*\)/i
  )
  if (merged) return `system.${merged[1]}`

  const plain = scrubbed.match(/\bFROM\s+system\.(\w+)/i)
  if (plain) return `system.${plain[1]}`

  const named = scrubbed.match(/\bFROM\s+([A-Za-z_]\w*)\b/i)
  return named ? (ctes.get(named[1]) ?? null) : null
}

// ---------------------------------------------------------------------------
// SQL splitting
// ---------------------------------------------------------------------------

/** Strip comments and string literals so they cannot be read as identifiers. */
function scrub(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

/** Split a select list into top-level items (commas at paren depth 0). */
function topLevelItems(selectList: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of selectList) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) items.push(current)
  return items
}

interface SelectScope {
  /** The select list itself. */
  selectList: string
  /** Everything from SELECT to the end of the query (WHERE/HAVING/ORDER BY …). */
  tail: string
}

/**
 * Every `SELECT …` scope in the statement, innermost last. `FROM`/`WHERE` of
 * each scope are recovered by paren matching, which is what makes a nested
 * CTE and the outer select separable.
 */
function selectScopes(sql: string): SelectScope[] {
  const scrubbed = scrub(sql)
  const scopes: SelectScope[] = []
  const re = /\bSELECT\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(scrubbed)) !== null) {
    const start = match.index + match[0].length
    let scanDepth = 0
    let end = scrubbed.length
    for (let i = start; i < scrubbed.length; i++) {
      const ch = scrubbed[i]
      if (ch === '(') scanDepth++
      else if (ch === ')') {
        if (scanDepth === 0) {
          end = i
          break
        }
        scanDepth--
      }
    }
    const tail = scrubbed.slice(start, end)
    // Cut the select list at its own top-level FROM — everything after belongs
    // to the clause walk, not to the item list.
    let cut = tail.length
    let depth = 0
    for (let i = 0; i < tail.length; i++) {
      const ch = tail[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (
        depth === 0 &&
        /\s/.test(ch) &&
        /^FROM\b/i.test(tail.slice(i + 1))
      ) {
        cut = i
        break
      }
    }
    scopes.push({ selectList: tail.slice(0, cut), tail })
  }
  return scopes
}

/** Index of this scope's own depth-0 `FROM`, or -1. */
function ownFromIndex(tail: string): number {
  let depth = 0
  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (
      depth === 0 &&
      /\s/.test(ch) &&
      /^FROM\b/i.test(tail.slice(i + 1))
    ) {
      return i + 1
    }
  }
  return -1
}

/** The `WHERE` clause of the scope owning `tail`, or '' when there is none. */
function whereClause(tail: string): string {
  const fromIndex = ownFromIndex(tail)
  const after = fromIndex === -1 ? tail : tail.slice(fromIndex)
  const m = after.match(
    /\bWHERE\b([\s\S]*?)(?=\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bUNION\b|$)/i
  )
  return m?.[1] ?? ''
}

// ---------------------------------------------------------------------------
// Aggregate function names. Needed because the fatal shape is specifically a
// NON-WINDOW aggregate wrapping the bare shadowed name — `sum(x) OVER ()` is
// fine, `sum(x)` is not.
// ---------------------------------------------------------------------------

const AGGREGATE_FUNCTIONS = new Set([
  'any',
  'anyHeavy',
  'anyLast',
  'argMax',
  'argMin',
  'avg',
  'avgIf',
  'count',
  'countIf',
  'groupArray',
  'groupBitAnd',
  'groupBitOr',
  'groupUniqArray',
  'max',
  'maxIf',
  'maxMap',
  'median',
  'min',
  'minIf',
  'quantile',
  'quantileExact',
  'quantileTDigest',
  'stddevPop',
  'stddevSamp',
  'sum',
  'sumIf',
  'sumKahan',
  'topK',
  'uniq',
  'uniqExact',
  'varPop',
  'varSamp',
])

/** An aggregate call over `name`, ignoring window functions. */
function aggregatesOver(expression: string, name: string): boolean {
  for (const m of expression.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    if (!AGGREGATE_FUNCTIONS.has(m[1])) continue
    // Find the matching close paren, then confirm no OVER() on this call.
    let depth = 0
    let close = -1
    for (let i = m.index + m[0].length - 1; i < expression.length; i++) {
      if (expression[i] === '(') depth++
      else if (expression[i] === ')') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close === -1) continue
    if (/\bOVER\b/i.test(expression.slice(close))) continue
    const args = expression.slice(m.index + m[0].length, close)
    if (new RegExp(`(^|[^\\w.])${name}([^\\w]|$)`).test(args)) return true
  }
  return false
}

/** True when the bare name appears as a whole identifier in `text`. */
function readsBareIdentifier(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w.])${name}([^\\w]|$)`).test(text)
}

/**
 * True when the alias's own defining expression aggregates. Only an AGGREGATE
 * alias is the fatal shape — that is literally what the server names in
 * `Aggregate function <expr> AS <name> is found in …`. A non-aggregate alias
 * that reuses a column name is legal and common:
 * `toStartOfHour(event_time) AS event_time` is the bucketing idiom behind every
 * time-series chart, and `buildTimeFilter`'s `WHERE event_time >= …` on such a
 * query is fine (verified ok on 24.3 and 26.7).
 */
function definesAggregate(item: string): boolean {
  for (const m of item.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    if (AGGREGATE_FUNCTIONS.has(m[1])) return true
  }
  return false
}

interface Offender {
  table: string
  name: string
  why: string
}

/**
 * Offenders in one statement: a select-list alias whose name is also a column
 * of that select's source table, and either its own WHERE clause reads the
 * bare name, or a sibling item wraps it in a non-window aggregate.
 */
function offendersIn(sql: string): Offender[] {
  const offenders: Offender[] = []
  const ctes = cteTables(sql)
  for (const scope of selectScopes(sql)) {
    const table = sourceTable(scope.tail, ctes)
    const columns = [...(TABLE_COLUMNS[table ?? ''] ?? [])]
    if (columns.length === 0) continue

    const items = topLevelItems(scope.selectList)
    const aliases = new Map<string, string>()
    for (const item of items) {
      const alias = item.match(/\bAS\s+([A-Za-z_]\w*)\s*$/i)?.[1]
      if (alias) aliases.set(alias, item)
    }

    const where = whereClause(scope.tail)
    for (const [name, item] of aliases) {
      if (!columns.includes(name)) continue
      if (!definesAggregate(item)) continue

      if (readsBareIdentifier(where, name)) {
        offenders.push({
          table: table ?? 'unknown',
          name,
          why: `WHERE reads \`${name}\`, which this SELECT defines as \`${item
            .trim()
            .replace(/\s+/g, ' ')}\``,
        })
        continue
      }

      for (const other of items) {
        if (other === item) continue
        if (!aggregatesOver(other, name)) continue
        offenders.push({
          table: table ?? 'unknown',
          name,
          why: `a sibling select item aggregates \`${name}\`: \`${other
            .trim()
            .replace(/\s+/g, ' ')}\``,
        })
        break
      }
    }
  }
  return offenders
}

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
 * SQL that never reaches the `queries` registry: the chart builders and the
 * two ad-hoc collector/advisor queries. Both shipped this bug (the chart as
 * `query-metric-log-memory`, the collector as the heavy-queries insight), so
 * scanning only the registry would have missed them.
 */
function adHocVariants(): Variant[] {
  const variants: Variant[] = []

  const registries: Record<string, Record<string, ChartQueryBuilder>> = {
    'query-charts': queryCharts,
    'query-insights-charts': queryInsightsCharts,
    'query-perf-charts': queryPerfCharts,
  }
  for (const [group, registry] of Object.entries(registries)) {
    for (const [name, build] of Object.entries(registry)) {
      const built = build({})
      if (typeof built.query === 'string') {
        variants.push({
          configName: `${group}:${name}`,
          since: '-',
          sql: built.query,
        })
      }
    }
  }

  for (const filters of [
    {},
    { keyword: 'SELECT', user: 'default', kind: 'select', minDurationMs: 5 },
  ]) {
    const built = buildHistoryPickerQuery(filters as HistoryPickerFilters)
    variants.push({
      configName: `history-picker:${JSON.stringify(filters)}`,
      since: '-',
      sql: built.sql,
    })
  }

  return variants
}

describe('aggregate aliases must not shadow a source column', () => {
  const allVariants = [
    ...Object.values(queries).flatMap((config) =>
      variantsOf(config as QueryConfig)
    ),
    ...adHocVariants(),
  ]

  test('no shipped query shadows a source column with an aggregate alias', () => {
    const offenders = allVariants.flatMap((v) =>
      offendersIn(v.sql).map(
        (o) =>
          `${v.configName} (since ${v.since}): \`AS ${o.name}\` shadows a column of ${o.table} — ${o.why}`
      )
    )
    expect(offenders).toEqual([])
  })

  // The detector is only worth having if it fires on the shape that shipped
  // broken. Both are pinned against the exact pre-fix SQL.
  test('detects the heavy-queries insight bug this guard was written for', () => {
    const preFix: Variant = {
      configName: 'heavy-queries (pre-fix)',
      since: '-',
      sql: `
        SELECT any(query) AS query
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND read_bytes > 10000000
          AND query NOT ILIKE '%system.%'
        GROUP BY normalized_query_hash
        ORDER BY max(read_bytes) DESC
        LIMIT 3
      `,
    }
    expect(offendersIn(preFix.sql).map((o) => [o.name, o.why])).toEqual([
      [
        'query',
        'WHERE reads `query`, which this SELECT defines as `any(query) AS query`',
      ],
    ])
  })

  test('detects the aggregate-wraps-shadowing-alias bug', () => {
    const preFix: Variant = {
      configName: 'expensive-queries (pre-fix)',
      since: '24.1',
      sql: `
        WITH base_metrics AS (
          SELECT
            normalized_query_hash,
            sum(read_rows) AS read_rows,
            formatReadableQuantity(sum(read_rows)) AS readable_read_rows
          FROM system.query_log
          GROUP BY normalized_query_hash
        )
        SELECT *, round(100 * read_rows / max(read_rows) OVER (), 2) AS pct_read_rows
        FROM base_metrics
      `,
    }
    expect(offendersIn(preFix.sql).map((o) => o.name)).toEqual(['read_rows'])
  })

  // A window function is not the fatal shape, and a bare reference is not
  // either — the guard must not report either.
  test('allows a shadowing alias a window function or bare arithmetic reads', () => {
    const ok: Variant = {
      configName: 'window-and-bare',
      since: '-',
      sql: `
        WITH base_metrics AS (
          SELECT
            normalized_query_hash,
            sum(read_rows) AS read_rows,
            sum(read_rows) OVER () AS windowed,
            read_rows * 2 AS doubled
          FROM system.query_log
          GROUP BY normalized_query_hash
        )
        SELECT *, round(100 * read_rows / max(read_rows) OVER (), 2) AS pct_read_rows
        FROM base_metrics
      `,
    }
    expect(offendersIn(ok.sql)).toEqual([])
  })

  // `toStartOfHour(event_time) AS event_time` + `WHERE event_time >= …` is the
  // bucketing idiom behind every time-series chart and runs fine; only an
  // AGGREGATE alias is the fatal shape. Verified ok on 24.3 and 26.7.
  test('allows a non-aggregate alias that reuses a column name', () => {
    const ok: Variant = {
      configName: 'bucketed-series',
      since: '-',
      sql: `
        SELECT toStartOfHour(event_time) AS event_time,
               count() AS qps
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= now() - INTERVAL 24 HOUR
        GROUP BY event_time
        ORDER BY event_time ASC
      `,
    }
    expect(offendersIn(ok.sql)).toEqual([])
  })

  // The table allowlist is what keeps this sound: an alias on a table whose
  // columns are unknown cannot be proven to shadow anything.
  test('stays quiet for a table outside the allowlist', () => {
    const ok: Variant = {
      configName: 'unknown-table',
      since: '-',
      sql: `
        SELECT sum(x) AS x, formatReadableQuantity(sum(x)) AS q
        FROM system.something_we_do_not_model
        GROUP BY k
      `,
    }
    expect(offendersIn(ok.sql)).toEqual([])
  })

  // An alias over a fresh name is the sanctioned shape, even though it
  // aggregates the same column.
  test('allows an alias over a fresh name', () => {
    const ok: Variant = {
      configName: 'fresh-name',
      since: '-',
      sql: `
        SELECT normalized_query_hash,
               sum(read_rows) AS total_read_rows,
               formatReadableQuantity(sum(read_rows)) AS readable_read_rows
        FROM system.query_log
        GROUP BY normalized_query_hash
      `,
    }
    expect(offendersIn(ok.sql)).toEqual([])
  })
})
