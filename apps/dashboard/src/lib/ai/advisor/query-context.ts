/**
 * Query advisor — query-context layer (the I/O half of the engine).
 *
 * Everything the pure scorers in `@chm/query-advisor-core` need, gathered
 * read-only from ClickHouse: the query text behind a `query_id`, the table's
 * schema/parts statistics, and `EXPLAIN PLAN indexes=1` output. The packing of
 * those findings into a `QueryContext` is pure and lives in the package
 * (`buildQueryContext`).
 *
 * ABSOLUTE INVARIANT: read-only. Every statement issued here goes through
 * `readOnlyQuery` (which forces `clickhouse_settings.readonly = '1'`) and is a
 * `SELECT` or an `EXPLAIN` — nothing in this file executes, applies, or
 * mutates anything. See `__tests__/analyze-query.test.ts` for the enforcing
 * test.
 */

import type {
  ExplainIndexesInfo,
  PartsStats,
  TableSchema,
} from '@chm/query-advisor-core'

import { parseExplainIndexes } from '@chm/query-advisor-core'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

/** Resolve the SQL to analyze: the caller's raw `sql`, or the query text behind a `query_id`. */
export async function resolveSql(
  hostId: number,
  sql: string | undefined,
  queryId: string | undefined
): Promise<string | null> {
  if (sql?.trim()) return sql.trim()
  if (!queryId?.trim()) return null

  const rows = (await readOnlyQuery({
    query:
      "SELECT query FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish' ORDER BY event_time DESC LIMIT 1",
    query_params: { queryId },
    hostId,
  })) as Array<{ query: string }>

  return rows[0]?.query?.trim() ?? null
}

export async function fetchTableSchema(
  hostId: number,
  database: string,
  table: string
): Promise<TableSchema> {
  const [tableRows, columnRows, indexRows] = await Promise.all([
    readOnlyQuery({
      query:
        'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      query_params: { database, table },
      hostId,
    }) as Promise<Array<{ partition_key: string; sorting_key: string }>>,
    readOnlyQuery({
      query:
        'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      query_params: { database, table },
      hostId,
    }) as Promise<
      Array<{
        name: string
        type: string
        is_in_partition_key: number | string
        is_in_sorting_key: number | string
        data_compressed_bytes: number | string
        data_uncompressed_bytes: number | string
      }>
    >,
    readOnlyQuery({
      query:
        'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}',
      query_params: { database, table },
      hostId,
    }) as Promise<
      Array<{
        name: string
        type: string
        expression: string
        granularity: number | string
      }>
    >,
  ])

  const truthy = (v: number | string) => Number(v) === 1
  const splitKey = (key: string) =>
    key
      ? key
          .split(',')
          .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ''))
          .filter(Boolean)
      : []
  // `partition_key` is a full expression (e.g. `toYYYYMM(event_date)`, or
  // `(region, toYYYYMM(event_date))`), not a bare column list like
  // `sorting_key` usually is — a comma-split would miss that `event_date` is
  // already covered. Extract identifier-like tokens instead so `.includes()`
  // checks against it catch the column-wrapped-in-a-function case (accepting
  // that a function name like `toYYYYMM` is harmlessly captured as a token
  // too — false positives here just mean "assume already covered").
  const extractIdentifierTokens = (expr: string) =>
    [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0])

  return {
    database,
    table,
    partitionKeyColumns: extractIdentifierTokens(
      tableRows[0]?.partition_key ?? ''
    ),
    // sorting_key is matched by exact column equality (skip-index/projection
    // scorers) — this only recognizes bare column names, not expressions
    // (e.g. `toDate(created_at)`); a sorting key built from expressions is a
    // documented limitation, not a crash risk.
    sortingKeyColumns: splitKey(tableRows[0]?.sorting_key ?? ''),
    columns: columnRows.map((c) => ({
      name: c.name,
      type: c.type,
      isInPartitionKey: truthy(c.is_in_partition_key),
      isInSortingKey: truthy(c.is_in_sorting_key),
      compressedBytes: Number(c.data_compressed_bytes),
      uncompressedBytes: Number(c.data_uncompressed_bytes),
    })),
    existingSkipIndexes: indexRows.map((i) => ({
      name: i.name,
      type: i.type,
      expression: i.expression,
      granularity: Number(i.granularity),
    })),
  }
}

export async function fetchPartsStats(
  hostId: number,
  database: string,
  table: string
): Promise<PartsStats> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT count() AS active_parts, sum(rows) AS total_rows, sum(bytes_on_disk) AS total_bytes, sum(marks) AS total_granules FROM system.parts WHERE active = 1 AND database = {database:String} AND table = {table:String}',
    query_params: { database, table },
    hostId,
  })) as Array<{
    active_parts: number | string
    total_rows: number | string
    total_bytes: number | string
    total_granules: number | string
  }>

  const row = rows[0]
  return {
    activeParts: Number(row?.active_parts ?? 0),
    totalRows: Number(row?.total_rows ?? 0),
    totalBytes: Number(row?.total_bytes ?? 0),
    totalGranules: Number(row?.total_granules ?? 0),
  }
}

/** Best-effort `EXPLAIN PLAN indexes=1`; returns `null` (never throws) if the query can't be explained. */
export async function fetchExplainIndexes(
  hostId: number,
  sql: string
): Promise<ExplainIndexesInfo | null> {
  try {
    const rows = (await readOnlyQuery({
      query: `EXPLAIN PLAN indexes = 1 ${sql}`,
      hostId,
    })) as Array<{ explain: string }>
    return parseExplainIndexes(rows.map((r) => r.explain))
  } catch {
    return null
  }
}
