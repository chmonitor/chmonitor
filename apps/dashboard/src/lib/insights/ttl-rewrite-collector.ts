/**
 * TTL rewrite amplification insight collector (#4069, slice 1).
 *
 * Reads `system.part_log` (this host only: it is per replica) and
 * `system.tables.engine_full`. Thresholds and mapping live in
 * `ttl-rewrite-classifier.ts`. Fails open: a missing or disabled part_log, an
 * old server without `merge_reason`, or any error yields no insight.
 */

import type { InsightCandidate } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import { LOCAL_DATABASES_FILTER } from '../clickhouse-local-databases'
import { TTL_PARTITION_INVENTORY_SETTINGS } from '../health/ttl-partition-sql'
import {
  insightFromTtlRewriteRows,
  TTL_REWRITE_MIN_AMPLIFICATION,
  TTL_REWRITE_MIN_READ_BYTES,
  TTL_REWRITE_WINDOW_DAYS,
} from './ttl-rewrite-classifier'

const TTL_REWRITE_LIMIT = 20

/** Client settings: the cap travels as a request setting, not a SQL clause. */
export const TTL_REWRITE_SETTINGS = TTL_PARTITION_INVENTORY_SETTINGS

/**
 * Read-only. Bounded by `event_date`, the host-local `part_log`, and a LIMIT.
 * No backslashes: `[ ]*` instead of `\s*` keeps the text identical in TS and SQL.
 */
export const ttlRewriteSql = `WITH ttl_merges AS (
  SELECT
    database,
    table,
    sum(read_bytes) AS ttl_read_bytes
  FROM system.part_log
  WHERE event_date >= today() - ${TTL_REWRITE_WINDOW_DAYS}
    AND event_time >= now() - INTERVAL ${TTL_REWRITE_WINDOW_DAYS} DAY
    AND event_type = 'MergeParts'
    AND merge_reason = 'TTLDeleteMerge'
  GROUP BY database, table
  HAVING ttl_read_bytes >= ${TTL_REWRITE_MIN_READ_BYTES}
),
ingest AS (
  SELECT
    database,
    table,
    sum(size_in_bytes) AS ingest_bytes
  FROM system.part_log
  WHERE event_date >= today() - ${TTL_REWRITE_WINDOW_DAYS}
    AND event_time >= now() - INTERVAL ${TTL_REWRITE_WINDOW_DAYS} DAY
    AND event_type = 'NewPart'
    AND (database, table) IN (SELECT database, table FROM ttl_merges)
  GROUP BY database, table
),
ttl_tables AS (
  SELECT
    database,
    name AS table,
    partition_key,
    trim(BOTH ' ' FROM replaceRegexpOne(
      substring(engine_full, positionCaseInsensitive(engine_full, ' TTL ') + 5),
      '(?s)[ ]+SETTINGS[ ]+.*$',
      ''
    )) AS ttl_expression,
    if(
      match(engine_full, 'ttl_only_drop_parts[ ]*=[ ]*[01]'),
      extract(engine_full, 'ttl_only_drop_parts[ ]*=[ ]*([01])'),
      toString((
        SELECT value FROM system.merge_tree_settings
        WHERE name = 'ttl_only_drop_parts'
      ))
    ) AS ttl_only_drop_parts
  FROM system.tables
  WHERE is_temporary = 0
    AND ${LOCAL_DATABASES_FILTER}
    AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    AND positionCaseInsensitive(engine, 'MergeTree') > 0
    AND positionCaseInsensitive(engine_full, ' TTL ') > 0
)
SELECT
  m.database AS database,
  m.table AS table,
  m.ttl_read_bytes AS ttl_read_bytes,
  ifNull(i.ingest_bytes, 0) AS ingest_bytes,
  t.partition_key AS partition_key,
  t.ttl_expression AS ttl_expression,
  t.ttl_only_drop_parts AS ttl_only_drop_parts
FROM ttl_merges AS m
INNER JOIN ttl_tables AS t ON t.database = m.database AND t.table = m.table
LEFT JOIN ingest AS i ON i.database = m.database AND i.table = m.table
WHERE t.ttl_only_drop_parts != '1'
  AND m.ttl_read_bytes >= ${TTL_REWRITE_MIN_AMPLIFICATION} * greatest(ifNull(i.ingest_bytes, 0), 1)
ORDER BY m.ttl_read_bytes DESC
LIMIT ${TTL_REWRITE_LIMIT}`

export async function collectTtlRewriteAmplification(
  hostId: number
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query: ttlRewriteSql,
      hostId,
      clickhouse_settings: TTL_REWRITE_SETTINGS,
    })
    return insightFromTtlRewriteRows(rows)
  } catch {
    return []
  }
}
