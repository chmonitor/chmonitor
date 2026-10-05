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
import {
  type ClusterTopology,
  topologyFromDistributedTable,
} from '@/lib/ddl/on-cluster'

/** Same call shape as `readOnlyQuery`. Tests pass a stand-in; production uses the guard. */
export type SchemaQuerier = (options: {
  query: string
  hostId: number
  query_params?: Record<string, unknown>
}) => Promise<unknown>

/**
 * One round trip for `system.tables` + `system.columns` (ordered by position)
 * + `system.data_skipping_indices`. Identifiers stay in `query_params`.
 * Tuple fields are positional so JSONEachRow arrays and named-tuple objects
 * both decode.
 */
const TABLE_SCHEMA_SQL = `
SELECT
  ifNull(
    (SELECT partition_key FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1),
    ''
  ) AS partition_key,
  ifNull(
    (SELECT sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1),
    ''
  ) AS sorting_key,
  arraySort(t -> t.1, (
    SELECT groupArray(tuple(
      position,
      name,
      type,
      is_in_partition_key,
      is_in_sorting_key,
      data_compressed_bytes,
      data_uncompressed_bytes
    ))
    FROM system.columns
    WHERE database = {database:String} AND table = {table:String}
  )) AS columns,
  (
    SELECT groupArray(tuple(name, type, expr, granularity))
    FROM system.data_skipping_indices
    WHERE database = {database:String} AND table = {table:String}
  ) AS skip_indexes
`.trim()

function tupleAt(value: unknown, index: number, name: string): unknown {
  if (Array.isArray(value)) return value[index]
  if (value && typeof value === 'object') {
    return (value as Record<string, unknown>)[name]
  }
  return undefined
}

function asTupleList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

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
  table: string,
  query: SchemaQuerier = readOnlyQuery
): Promise<TableSchema> {
  const rows = (await query({
    query: TABLE_SCHEMA_SQL,
    query_params: { database, table },
    hostId,
  })) as Array<{
    partition_key: string
    sorting_key: string
    columns: unknown
    skip_indexes: unknown
  }>

  const truthy = (v: unknown) => Number(v) === 1
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

  const row = rows[0]
  const columnTuples = asTupleList(row?.columns)
    .map((entry) => ({
      position: Number(tupleAt(entry, 0, 'position')),
      name: String(tupleAt(entry, 1, 'name') ?? ''),
      type: String(tupleAt(entry, 2, 'type') ?? ''),
      isInPartitionKey: truthy(tupleAt(entry, 3, 'is_in_partition_key')),
      isInSortingKey: truthy(tupleAt(entry, 4, 'is_in_sorting_key')),
      compressedBytes: Number(tupleAt(entry, 5, 'data_compressed_bytes')),
      uncompressedBytes: Number(tupleAt(entry, 6, 'data_uncompressed_bytes')),
    }))
    .sort((a, b) => a.position - b.position)

  return {
    database,
    table,
    partitionKeyColumns: extractIdentifierTokens(row?.partition_key ?? ''),
    // sorting_key is matched by exact column equality (skip-index/projection
    // scorers) — this only recognizes bare column names, not expressions
    // (e.g. `toDate(created_at)`); a sorting key built from expressions is a
    // documented limitation, not a crash risk.
    sortingKeyColumns: splitKey(row?.sorting_key ?? ''),
    columns: columnTuples.map((column) => ({
      name: column.name,
      type: column.type,
      isInPartitionKey: column.isInPartitionKey,
      isInSortingKey: column.isInSortingKey,
      compressedBytes: column.compressedBytes,
      uncompressedBytes: column.uncompressedBytes,
    })),
    existingSkipIndexes: asTupleList(row?.skip_indexes).map((entry) => ({
      name: String(tupleAt(entry, 0, 'name') ?? ''),
      type: String(tupleAt(entry, 1, 'type') ?? ''),
      expression: String(tupleAt(entry, 2, 'expr') ?? ''),
      granularity: Number(tupleAt(entry, 3, 'granularity')),
    })),
  }
}

/** Best-effort cluster topology for copyable ON CLUSTER variants. Never throws. */
export async function fetchTableTopology(
  hostId: number,
  database: string,
  table: string
): Promise<ClusterTopology> {
  try {
    const tableRows = (await readOnlyQuery({
      query:
        'SELECT engine, engine_full FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
      query_params: { database, table },
      hostId,
    })) as Array<{ engine: string; engine_full: string }>
    const row = tableRows[0]
    const fromDist = topologyFromDistributedTable({
      engine: row?.engine,
      engineFull: row?.engine_full,
    })
    if (fromDist) return fromDist

    const clusterRows = (await readOnlyQuery({
      query:
        'SELECT cluster FROM system.clusters WHERE is_local = 1 ORDER BY cluster LIMIT 1',
      hostId,
    })) as Array<{ cluster: string }>
    const cluster = clusterRows[0]?.cluster?.trim()
    if (!cluster) return null
    return { cluster, localDatabase: database, localTable: table }
  } catch {
    return null
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
