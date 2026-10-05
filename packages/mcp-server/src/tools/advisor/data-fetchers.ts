/**
 * MCP-specific I/O layer for the query advisor — everything that reaches out
 * to ClickHouse via `runReadonlyFetch`. The pure parsing/scoring/estimating
 * logic lives in `@chm/query-advisor-core`, shared with the dashboard engine
 * (`apps/dashboard/src/lib/ai/advisor/`) so the two surfaces cannot recommend
 * different things for the same query — see `./index.ts` for the invariant
 * this whole `advisor/` tree preserves.
 */

import type {
  EstimatedImpact,
  ExplainIndexesInfo,
  PartsStats,
  TableSchema,
} from '@chm/query-advisor-core'

import { runReadonlyFetch } from '../helpers'
import {
  parseExplainIndexes,
  prewhereFallbackImpact,
  sumEstimateMarks,
  summarizePrewhereMarks,
} from '@chm/query-advisor-core'

/** Runs a read-only fetch and throws on error, mirroring the dashboard's `readOnlyQuery` so the orchestration logic reads the same way. */
export async function readOnly<T>(
  query: string,
  hostId: number,
  query_params?: Record<string, unknown>
): Promise<T> {
  const result = await runReadonlyFetch({ query, hostId, query_params })
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

export async function resolveSql(
  hostId: number,
  sql: string | undefined,
  queryId: string | undefined
): Promise<string | null> {
  if (sql?.trim()) return sql.trim()
  if (!queryId?.trim()) return null

  const rows = await readOnly<Array<{ query: string }>>(
    "SELECT query FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish' ORDER BY event_time DESC LIMIT 1",
    hostId,
    { queryId }
  )
  return rows[0]?.query?.trim() ?? null
}

const TABLE_SCHEMA_SQL = `
SELECT
  ifNull(tupleElement(table_meta, 1), '') AS partition_key,
  ifNull(tupleElement(table_meta, 2), '') AS sorting_key,
  columns,
  skip_indexes
FROM
(
  SELECT
    (
      SELECT tuple(partition_key, sorting_key)
      FROM system.tables
      WHERE database = {database:String} AND name = {table:String}
      LIMIT 1
    ) AS table_meta,
    (
      SELECT groupArray(tuple(
        position,
        name,
        type,
        is_in_partition_key,
        is_in_sorting_key,
        data_compressed_bytes,
        data_uncompressed_bytes
      ))
      FROM
      (
        SELECT
          position,
          name,
          type,
          is_in_partition_key,
          is_in_sorting_key,
          data_compressed_bytes,
          data_uncompressed_bytes
        FROM system.columns
        WHERE database = {database:String} AND table = {table:String}
        ORDER BY position
      )
    ) AS columns,
    (
      SELECT groupArray(tuple(name, type, expr, granularity))
      FROM system.data_skipping_indices
      WHERE database = {database:String} AND table = {table:String}
    ) AS skip_indexes
)
`.trim()

type ColumnTuple = {
  position: number
  name: string
  type: string
  is_in_partition_key: number | string
  is_in_sorting_key: number | string
  data_compressed_bytes: number | string
  data_uncompressed_bytes: number | string
}

type IndexTuple = {
  name: string
  type: string
  expr: string
  granularity: number | string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readColumns(raw: unknown): ColumnTuple[] {
  if (!Array.isArray(raw)) return []
  const columns: ColumnTuple[] = []
  for (const item of raw) {
    if (Array.isArray(item)) {
      columns.push({
        position: Number(item[0] ?? 0),
        name: String(item[1] ?? ''),
        type: String(item[2] ?? ''),
        is_in_partition_key: (item[3] ?? 0) as number | string,
        is_in_sorting_key: (item[4] ?? 0) as number | string,
        data_compressed_bytes: (item[5] ?? 0) as number | string,
        data_uncompressed_bytes: (item[6] ?? 0) as number | string,
      })
      continue
    }
    const row = asRecord(item)
    if (!row || typeof row.name !== 'string') continue
    columns.push({
      position: Number(row.position ?? 0),
      name: row.name,
      type: String(row.type ?? ''),
      is_in_partition_key: (row.is_in_partition_key ?? 0) as number | string,
      is_in_sorting_key: (row.is_in_sorting_key ?? 0) as number | string,
      data_compressed_bytes: (row.data_compressed_bytes ?? 0) as
        | number
        | string,
      data_uncompressed_bytes: (row.data_uncompressed_bytes ?? 0) as
        | number
        | string,
    })
  }
  columns.sort((a, b) => a.position - b.position)
  return columns
}

function readIndexes(raw: unknown): IndexTuple[] {
  if (!Array.isArray(raw)) return []
  const indexes: IndexTuple[] = []
  for (const item of raw) {
    if (Array.isArray(item)) {
      indexes.push({
        name: String(item[0] ?? ''),
        type: String(item[1] ?? ''),
        expr: String(item[2] ?? ''),
        granularity: (item[3] ?? 0) as number | string,
      })
      continue
    }
    const row = asRecord(item)
    if (!row || typeof row.name !== 'string') continue
    indexes.push({
      name: row.name,
      type: String(row.type ?? ''),
      expr: String(row.expr ?? ''),
      granularity: (row.granularity ?? 0) as number | string,
    })
  }
  return indexes
}

export async function fetchTableSchema(
  hostId: number,
  database: string,
  table: string
): Promise<TableSchema> {
  const rows = await readOnly<
    Array<{
      partition_key?: string
      sorting_key?: string
      columns?: unknown
      skip_indexes?: unknown
    }>
  >(TABLE_SCHEMA_SQL, hostId, { database, table })
  const row = rows[0]

  const truthy = (v: number | string) => Number(v) === 1
  const splitKey = (key: string) =>
    key
      ? key
          .split(',')
          .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ''))
          .filter(Boolean)
      : []
  const extractIdentifierTokens = (expr: string) =>
    [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0])

  return {
    database,
    table,
    partitionKeyColumns: extractIdentifierTokens(row?.partition_key ?? ''),
    sortingKeyColumns: splitKey(row?.sorting_key ?? ''),
    columns: readColumns(row?.columns).map((c) => ({
      name: c.name,
      type: c.type,
      isInPartitionKey: truthy(c.is_in_partition_key),
      isInSortingKey: truthy(c.is_in_sorting_key),
      compressedBytes: Number(c.data_compressed_bytes),
      uncompressedBytes: Number(c.data_uncompressed_bytes),
    })),
    existingSkipIndexes: readIndexes(row?.skip_indexes).map((i) => ({
      name: i.name,
      type: i.type,
      expression: i.expr,
      granularity: Number(i.granularity),
    })),
  }
}

export async function fetchPartsStats(
  hostId: number,
  database: string,
  table: string
): Promise<PartsStats> {
  const rows = await readOnly<
    Array<{
      active_parts: number | string
      total_rows: number | string
      total_bytes: number | string
      total_granules: number | string
    }>
  >(
    'SELECT count() AS active_parts, sum(rows) AS total_rows, sum(bytes_on_disk) AS total_bytes, sum(marks) AS total_granules FROM system.parts WHERE active = 1 AND database = {database:String} AND table = {table:String}',
    hostId,
    { database, table }
  )
  const row = rows[0]
  return {
    activeParts: Number(row?.active_parts ?? 0),
    totalRows: Number(row?.total_rows ?? 0),
    totalBytes: Number(row?.total_bytes ?? 0),
    totalGranules: Number(row?.total_granules ?? 0),
  }
}

export async function fetchExplainIndexes(
  hostId: number,
  sql: string
): Promise<ExplainIndexesInfo | null> {
  try {
    const rows = await readOnly<Array<{ explain: string }>>(
      `EXPLAIN PLAN indexes = 1 ${sql}`,
      hostId
    )
    return parseExplainIndexes(rows.map((r) => r.explain))
  } catch {
    return null
  }
}

export interface MeasurePrewhereImpactInput {
  hostId: number
  originalSql: string
  rewrittenSql: string
  /** Used only if the before/after EXPLAIN comparison itself fails. */
  fallbackGranulesRead: number
  fallbackGranulesTotal: number
  tableBytes: number
  movedColumn: string
}

/**
 * Best-effort "validate no plan breakage" check for the PREWHERE rewrite: two
 * read-only `EXPLAIN ESTIMATE` calls whose mark counts are handed to the
 * shared verdict function. Never executes either query for real.
 */
export async function measurePrewhereImpact(
  input: MeasurePrewhereImpactInput
): Promise<EstimatedImpact> {
  const {
    hostId,
    originalSql,
    rewrittenSql,
    fallbackGranulesRead,
    fallbackGranulesTotal,
    tableBytes,
    movedColumn,
  } = input

  try {
    const [before, after] = await Promise.all([
      readOnly<Array<{ marks: number | string }>>(
        `EXPLAIN ESTIMATE ${originalSql}`,
        hostId
      ),
      readOnly<Array<{ marks: number | string }>>(
        `EXPLAIN ESTIMATE ${rewrittenSql}`,
        hostId
      ),
    ])

    return summarizePrewhereMarks({
      beforeMarks: sumEstimateMarks(before),
      afterMarks: sumEstimateMarks(after),
      movedColumn,
    })
  } catch {
    return prewhereFallbackImpact({
      fallbackGranulesRead,
      fallbackGranulesTotal,
      tableBytes,
      movedColumn,
    })
  }
}
