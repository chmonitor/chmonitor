/**
 * Per-table retention forecast insight collector (#4069, slice 2).
 *
 * Reads `system.part_log` (this host only: it is per replica), `system.parts`
 * and `system.tables.engine_full`. Thresholds and mapping live in
 * `retention-forecast-classifier.ts`. Fails open: a missing or disabled
 * part_log, a server without a needed column, or any error yields no insight.
 */

import type { InsightCandidate } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import { LOCAL_DATABASES_FILTER } from '../clickhouse-local-databases'
import { TTL_PARTITION_INVENTORY_SETTINGS } from '../health/ttl-partition-sql'
import {
  insightFromRetentionForecastRows,
  RETENTION_MIN_DISK_BYTES,
  RETENTION_MIN_INGEST_SHARE,
  RETENTION_WINDOW_DAYS,
} from './retention-forecast-classifier'

const RETENTION_FORECAST_LIMIT = 5

/** Client settings: the cap travels as a request setting, not a SQL clause. */
export const RETENTION_FORECAST_SETTINGS = TTL_PARTITION_INVENTORY_SETTINGS

/**
 * Read-only. Bounded by `event_date`, the host-local `part_log`, and a LIMIT.
 *
 * Portable across `enable_analyzer` 0 and 1: plain CTEs, no lambda aliases in
 * WITH, no backslashes (`[ ]` instead of `\s`). The share is computed over all
 * non-system tables before the 50% filter, so a table's share does not depend
 * on which tables survive the later filters. "Older than N months" counts
 * active parts whose newest row (`max_date`) is that old, so a part that still
 * holds recent rows is never counted as freeable.
 */
export const retentionForecastSql = `WITH ingest AS (
  SELECT
    database,
    table,
    sum(size_in_bytes) AS ingest_bytes
  FROM system.part_log
  WHERE event_date >= today() - ${RETENTION_WINDOW_DAYS}
    AND event_time >= now() - INTERVAL ${RETENTION_WINDOW_DAYS} DAY
    AND event_type = 'NewPart'
    AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
  GROUP BY database, table
),
shares AS (
  SELECT
    database,
    table,
    ingest_bytes,
    sum(ingest_bytes) OVER () AS total_ingest_bytes
  FROM ingest
),
dominant AS (
  SELECT database, table, ingest_bytes, total_ingest_bytes
  FROM shares
  WHERE ingest_bytes >= ${RETENTION_MIN_INGEST_SHARE} * total_ingest_bytes
),
sizes AS (
  SELECT
    database,
    table,
    sum(bytes_on_disk) AS disk_bytes,
    sumIf(bytes_on_disk, max_date < addMonths(today(), -12)) AS older_12m_bytes,
    sumIf(bytes_on_disk, max_date < addMonths(today(), -24)) AS older_24m_bytes,
    sumIf(bytes_on_disk, max_date < addMonths(today(), -36)) AS older_36m_bytes
  FROM system.parts
  WHERE active
    AND (database, table) IN (SELECT database, table FROM dominant)
  GROUP BY database, table
  HAVING disk_bytes >= ${RETENTION_MIN_DISK_BYTES}
),
part_log_window AS (
  SELECT least(${RETENTION_WINDOW_DAYS}, dateDiff('day', min(event_date), today()) + 1) AS window_days
  FROM system.part_log
  WHERE event_date >= today() - ${RETENTION_WINDOW_DAYS}
)
SELECT
  d.database AS database,
  d.table AS table,
  d.ingest_bytes AS ingest_bytes,
  d.total_ingest_bytes AS total_ingest_bytes,
  (SELECT window_days FROM part_log_window) AS window_days,
  s.disk_bytes AS disk_bytes,
  s.older_12m_bytes AS older_12m_bytes,
  s.older_24m_bytes AS older_24m_bytes,
  s.older_36m_bytes AS older_36m_bytes,
  0 AS has_ttl
FROM dominant AS d
INNER JOIN sizes AS s ON s.database = d.database AND s.table = d.table
WHERE (d.database, d.table) IN (
  SELECT database, name
  FROM system.tables
  WHERE is_temporary = 0
    AND ${LOCAL_DATABASES_FILTER}
    AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    AND positionCaseInsensitive(engine, 'MergeTree') > 0
    AND positionCaseInsensitive(engine_full, ' TTL ') = 0
)
ORDER BY d.ingest_bytes DESC
LIMIT ${RETENTION_FORECAST_LIMIT}`

export async function collectRetentionForecast(
  hostId: number
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query: retentionForecastSql,
      hostId,
      clickhouse_settings: RETENTION_FORECAST_SETTINGS,
    })
    return insightFromRetentionForecastRows(rows)
  } catch {
    return []
  }
}
