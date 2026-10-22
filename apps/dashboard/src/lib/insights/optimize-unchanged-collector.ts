/**
 * OPTIMIZE FINAL on unchanged data insight collector (#4069, slice 3).
 *
 * Reads `system.query_log` and `system.part_log` of this host only (both are
 * per replica; no `clusterAllReplicas`). Thresholds and mapping live in
 * `optimize-unchanged-classifier.ts`. Fails open: a missing or disabled log,
 * a server without a needed column, or any error yields no insight.
 */

import type { InsightCandidate } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import { TTL_PARTITION_INVENTORY_SETTINGS } from '../health/ttl-partition-sql'
import {
  insightFromOptimizeUnchangedRows,
  OPTIMIZE_UNCHANGED_MIN_RUNS,
  OPTIMIZE_UNCHANGED_WINDOW_DAYS,
} from './optimize-unchanged-classifier'

const OPTIMIZE_UNCHANGED_LIMIT = 20

/** Client settings: the cap travels as a request setting, not a SQL clause. */
export const OPTIMIZE_UNCHANGED_SETTINGS = TTL_PARTITION_INVENTORY_SETTINGS

/**
 * Read-only. Bounded by `event_date`, the host-local logs, and a LIMIT.
 *
 * How it works (observed on a real server, see docs/knowledge/ai-insights.md):
 * a finished `OPTIMIZE` is one `query_log` row with `type = 'QueryFinish'`,
 * `query_kind = 'Optimize'`, and `tables = ['db.table']` always qualified, even
 * after `USE db`. The statement text tells FINAL from plain OPTIMIZE. `NewPart`
 * `part_log` rows are inserts; the merges an OPTIMIZE causes are `MergeParts`,
 * so they never count as new data. Timestamps are compared at microsecond
 * resolution because a run and an insert often share the same second.
 *
 * The two logs are merged into one stream per table (`is_run` 0 = new part,
 * 1 = optimize run) and a running count of new parts is read at each run. A
 * run is "unchanged" when that count equals the one at the previous run. The
 * first run has no previous run (`rn = 1`) and is never unchanged.
 *
 * Portable across `enable_analyzer` 0 and 1: plain CTEs and window functions,
 * no lambda aliases in WITH, no backslashes (`[[:space:]]` instead of `\s`).
 */
export const optimizeUnchangedSql = `WITH runs AS (
  SELECT
    databases[1] AS database,
    arrayJoin(tables) AS full_name,
    event_time_microseconds AS ts
  FROM system.query_log
  WHERE event_date >= today() - ${OPTIMIZE_UNCHANGED_WINDOW_DAYS}
    AND event_time >= now() - INTERVAL ${OPTIMIZE_UNCHANGED_WINDOW_DAYS} DAY
    AND type = 'QueryFinish'
    AND query_kind = 'Optimize'
    AND match(query, '(?i)[[:space:]]FINAL([[:space:]]|;|$)')
    AND databases[1] NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
),
new_parts AS (
  SELECT
    concat(database, '.', table) AS full_name,
    event_time_microseconds AS ts
  FROM system.part_log
  WHERE event_date >= today() - ${OPTIMIZE_UNCHANGED_WINDOW_DAYS}
    AND event_time >= now() - INTERVAL ${OPTIMIZE_UNCHANGED_WINDOW_DAYS} DAY
    AND event_type = 'NewPart'
    AND concat(database, '.', table) IN (SELECT full_name FROM runs)
),
stream AS (
  SELECT full_name, ts, toUInt8(0) AS is_run, toUInt8(1) AS is_part, '' AS database FROM new_parts
  UNION ALL
  SELECT full_name, ts, toUInt8(1) AS is_run, toUInt8(0) AS is_part, database FROM runs
),
counted AS (
  SELECT
    full_name,
    database,
    is_run,
    sum(is_part) OVER (
      PARTITION BY full_name ORDER BY ts, is_run
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS parts_so_far,
    ts
  FROM stream
),
run_rows AS (
  SELECT
    full_name,
    database,
    parts_so_far,
    row_number() OVER (PARTITION BY full_name ORDER BY ts) AS rn,
    lagInFrame(parts_so_far, 1, 0) OVER (
      PARTITION BY full_name ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS parts_at_previous_run
  FROM counted
  WHERE is_run = 1
)
SELECT
  database,
  substring(full_name, length(database) + 2) AS table,
  count() AS runs,
  countIf(rn > 1 AND parts_so_far = parts_at_previous_run) AS unchanged_runs
FROM run_rows
GROUP BY database, full_name
HAVING unchanged_runs >= ${OPTIMIZE_UNCHANGED_MIN_RUNS}
ORDER BY unchanged_runs DESC
LIMIT ${OPTIMIZE_UNCHANGED_LIMIT}`

export async function collectOptimizeUnchanged(
  hostId: number
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query: optimizeUnchangedSql,
      hostId,
      clickhouse_settings: OPTIMIZE_UNCHANGED_SETTINGS,
    })
    return insightFromOptimizeUnchangedRows(rows)
  } catch {
    return []
  }
}
