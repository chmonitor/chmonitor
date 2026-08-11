/**
 * MCP-specific I/O layer for the query advisor — everything that reaches out
 * to ClickHouse via `runReadonlyFetch`. See `../advisor.ts` header for the
 * duplication note this whole `advisor/` tree inherits and the
 * ABSOLUTE INVARIANT (recommend-only / read-only) it must preserve.
 */

import type {
  EstimatedImpact,
  ExplainIndexesInfo,
  PartsStats,
  TableSchema,
} from './types'

import { runReadonlyFetch } from '../helpers'
import { summarizeImpact } from './impact'
import { parseExplainIndexes } from './sql-parse'

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

export async function fetchTableSchema(
  hostId: number,
  database: string,
  table: string
): Promise<TableSchema> {
  const [tableRows, columnRows, indexRows] = await Promise.all([
    readOnly<Array<{ partition_key: string; sorting_key: string }>>(
      'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      hostId,
      { database, table }
    ),
    readOnly<
      Array<{
        name: string
        type: string
        is_in_partition_key: number | string
        is_in_sorting_key: number | string
        data_compressed_bytes: number | string
        data_uncompressed_bytes: number | string
      }>
    >(
      'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      hostId,
      { database, table }
    ),
    readOnly<
      Array<{
        name: string
        type: string
        expression: string
        granularity: number | string
      }>
    >(
      'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}',
      hostId,
      { database, table }
    ),
  ])

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
    partitionKeyColumns: extractIdentifierTokens(
      tableRows[0]?.partition_key ?? ''
    ),
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

export async function measurePrewhereImpact(
  hostId: number,
  originalSql: string,
  rewrittenSql: string,
  fallbackGranulesRead: number,
  fallbackGranulesTotal: number,
  tableBytes: number,
  movedColumn: string
): Promise<EstimatedImpact> {
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
    const beforeMarks = before.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)
    const afterMarks = after.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)

    if (afterMarks > beforeMarks) {
      return {
        granulesSaved: 0,
        granulesRead: beforeMarks,
        bytesSaved: 0,
        unknown: false,
        summary: `Rewrite validation: EXPLAIN ESTIMATE shows the PREWHERE rewrite reads MORE granules after (${afterMarks}) than before (${beforeMarks}) — do not apply this rewrite as-is; the estimate suggests it could regress the plan.`,
      }
    }

    return {
      granulesSaved: 0,
      granulesRead: beforeMarks,
      bytesSaved: 0,
      unknown: false,
      summary: `Rewrite validated: EXPLAIN ESTIMATE shows unchanged granule selection before/after (${beforeMarks} granules) — moving \`${movedColumn}\` to PREWHERE avoids materializing other columns for rows filtered out by it, without changing which granules are read.`,
    }
  } catch {
    return summarizeImpact({
      granulesRead: fallbackGranulesRead,
      granulesTotal: fallbackGranulesTotal,
      granulesSaved: fallbackGranulesRead,
      tableBytes,
      unknown: fallbackGranulesTotal === 0,
      label: `moving \`${movedColumn}\` to PREWHERE`,
    })
  }
}
