/**
 * ClickHouse-backed mining for the MV/projection designer — pulls candidate
 * aggregation shapes from `system.query_log` and the per-table stats needed
 * to design + size a recommendation for each. Every query is read-only
 * (`readOnlyQuery` sets `readonly: '1'`).
 *
 * See `./index.ts` for the module overview.
 */

import type { AggregateCall } from './sql-parsing'

import { scaleCardinality } from './size-estimator'
import {
  extractAggregateCalls,
  extractGroupByKeys,
  formatGroupByListForSql,
  splitTopLevelCommas,
} from './sql-parsing'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import {
  extractReferencedTables,
  formatQualifiedTable,
} from '@/lib/ai/agent/tools/sql-analysis'

/** Row cap for the cardinality sample query — bounded so mining never triggers a full-table scan. */
export const CARDINALITY_SAMPLE_SIZE = 100_000

export interface MinedShape {
  hash: string
  calls: number
  totalReadBytes: number
  sampleQuery: string
  tableCount: number
  database: string
  table: string
  groupByKeys: string[]
  aggregateCalls: AggregateCall[]
}

export async function mineAggregationShapes(
  hostId: number,
  windowHours: number,
  topN: number
): Promise<MinedShape[]> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT normalized_query_hash AS hash, count() AS calls, sum(read_bytes) AS total_read_bytes, any(query) AS sample_query ' +
      'FROM system.query_log ' +
      "WHERE type = 'QueryFinish' AND is_initial_query = 1 " +
      'AND event_time >= now() - INTERVAL {windowHours:UInt32} HOUR ' +
      "AND positionCaseInsensitive(query, 'GROUP BY') > 0 " +
      'GROUP BY hash ORDER BY total_read_bytes DESC LIMIT {topN:UInt32} ' +
      'SETTINGS max_execution_time = 25',
    query_params: { windowHours, topN },
    hostId,
  })) as Array<{
    hash: string
    calls: string | number
    total_read_bytes: string | number
    sample_query: string
  }>

  const shapes: MinedShape[] = []
  for (const row of rows) {
    const sql = row.sample_query
    const groupByKeys = extractGroupByKeys(sql)
    const aggregateCalls = extractAggregateCalls(sql)
    if (groupByKeys.length === 0 || aggregateCalls.length === 0) continue

    const tables = extractReferencedTables(sql)
    if (tables.length === 0) continue

    shapes.push({
      hash: row.hash,
      calls: Number(row.calls),
      totalReadBytes: Number(row.total_read_bytes),
      sampleQuery: sql,
      tableCount: tables.length,
      database: tables[0].database,
      table: tables[0].table,
      groupByKeys,
      aggregateCalls,
    })
  }
  return shapes
}

export async function getTableSizeStats(
  hostId: number,
  database: string,
  table: string
): Promise<{ rows: number; bytesOnDisk: number }> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sum(rows) AS rows, sum(bytes_on_disk) AS bytes_on_disk FROM system.parts ' +
      'WHERE active = 1 AND database = {database:String} AND table = {table:String} ' +
      'SETTINGS max_execution_time = 25',
    query_params: { database, table },
    hostId,
  })) as Array<{ rows: string | number; bytes_on_disk: string | number }>

  return {
    rows: Number(rows[0]?.rows ?? 0),
    bytesOnDisk: Number(rows[0]?.bytes_on_disk ?? 0),
  }
}

/** Ordered sorting-key column/expression list, derived from `system.tables.sorting_key` (a comma-joined expression string). */
export async function getSortingKeyColumns(
  hostId: number,
  database: string,
  table: string
): Promise<string[]> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
    query_params: { database, table },
    hostId,
  })) as Array<{ sorting_key: string }>

  const sortingKey = rows[0]?.sorting_key ?? ''
  if (!sortingKey.trim()) return []
  return splitTopLevelCommas(sortingKey)
}

/**
 * Cheap, bounded cardinality estimate for the GROUP BY key combination —
 * `uniqCombined` over a row-capped sample (never a full-table scan), scaled
 * up to the table's full row count. This resolves the plan's "cardinality
 * source" open question: a LIMIT-bounded sample is available on every
 * MergeTree table (unlike `SAMPLE n`, which needs a declared sampling key).
 */
export async function estimateGroupCardinality(
  hostId: number,
  database: string,
  table: string,
  groupByKeys: string[],
  sourceRows: number
): Promise<number> {
  const sampleSize = Math.min(CARDINALITY_SAMPLE_SIZE, sourceRows)
  if (sampleSize <= 0) return 0

  const fullTable = formatQualifiedTable(database, table)
  const cols = formatGroupByListForSql(groupByKeys)
  const rows = (await readOnlyQuery({
    query:
      `SELECT uniqCombined(${cols}) AS distinct_combos FROM ` +
      `(SELECT ${cols} FROM ${fullTable} LIMIT {sampleSize:UInt32}) ` +
      'SETTINGS max_execution_time = 25',
    query_params: { sampleSize },
    hostId,
  })) as Array<{ distinct_combos: string | number }>

  const sampleDistinct = Number(rows[0]?.distinct_combos ?? 0)
  return scaleCardinality(sampleDistinct, sampleSize, sourceRows)
}
