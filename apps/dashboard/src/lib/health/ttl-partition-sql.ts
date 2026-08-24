/**
 * Shared TTL / PARTITION BY inventory SQL.
 *
 * One CTE family backs the Tables inventory page, the /health card scalar,
 * the health-detail breakdown, and the matching alert rule. Heuristics stay
 * in ttl-partition-heuristics.ts; this file only builds read-only SELECT
 * strings. Never ALTER TTL or DROP PARTITION.
 *
 * Reads system.tables + system.parts only — no system.part_log, no
 * create_table_query, no fictional system.tables.ttl column.
 */

import {
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
  PARTS_PER_PARTITION_WARNING,
} from './ttl-partition-heuristics'

const SYSTEM_DATABASES = `'system', 'INFORMATION_SCHEMA', 'information_schema'`

/** Cap the /health batched scalar so one check cannot hang the grid. */
export const TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME = 15
/** Inventory page can afford a slightly longer scan. */
export const TTL_PARTITION_INVENTORY_MAX_EXECUTION_TIME = 25

/** Table TTL is the clause after ` TTL ` in engine_full, before SETTINGS. */
const TTL_FROM_ENGINE_FULL = `
      if(
        positionCaseInsensitive(t.engine_full, ' TTL ') > 0,
        trim(BOTH ' ' FROM replaceRegexpOne(
          substring(
            t.engine_full,
            positionCaseInsensitive(t.engine_full, ' TTL ') + 5
          ),
          '\\\\s+SETTINGS\\\\s+.*$',
          ''
        )),
        ''
      )`

/**
 * Approximate TTL window in days from a table TTL expression.
 * Covers `INTERVAL n UNIT` and `toIntervalX(n)`. Unparseable → 0.
 */
export const TTL_DAYS_SQL = `
      multiIf(
        match(ttl_expression, '(?i)toIntervalYear\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+YEAR'),
          toUInt32OrZero(extract(ttl_expression, '(\\\\d+)')) * 365,
        match(ttl_expression, '(?i)toIntervalQuarter\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+QUARTER'),
          toUInt32OrZero(extract(ttl_expression, '(\\\\d+)')) * 90,
        match(ttl_expression, '(?i)toIntervalMonth\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+MONTH'),
          toUInt32OrZero(extract(ttl_expression, '(\\\\d+)')) * 30,
        match(ttl_expression, '(?i)toIntervalWeek\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+WEEK'),
          toUInt32OrZero(extract(ttl_expression, '(\\\\d+)')) * 7,
        match(ttl_expression, '(?i)toIntervalDay\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+DAY'),
          toUInt32OrZero(extract(ttl_expression, '(\\\\d+)')),
        match(ttl_expression, '(?i)toIntervalHour\\\\s*\\\\(\\\\s*\\\\d+')
          OR match(ttl_expression, '(?i)INTERVAL\\\\s+\\\\d+\\\\s+HOUR'),
          1,
        0
      )`

const TIME_BASED_PARTITION_SQL = `(
        positionCaseInsensitive(t.partition_key, 'toYYYYMM') > 0
        OR positionCaseInsensitive(t.partition_key, 'toStartOf') > 0
        OR positionCaseInsensitive(t.partition_key, 'toDate') > 0
        OR positionCaseInsensitive(t.partition_key, 'toMonday') > 0
        OR positionCaseInsensitive(t.partition_key, 'toYearWeek') > 0
        OR positionCaseInsensitive(t.partition_key, 'toISOWeek') > 0
      )`

const RECOMMENDATION_SQL = `
      multiIf(
        ifNull(p.partitions, 0) >= ${PARTITION_COUNT_CRITICAL},
          'Rebuild with coarser PARTITION BY',
        ifNull(p.partitions, 0) >= ${PARTITION_COUNT_WARNING},
          'Consider monthly partitions',
        ${TIME_BASED_PARTITION_SQL}
          AND positionCaseInsensitive(t.engine_full, ' TTL ') = 0,
          'Add table TTL',
        ifNull(p.partitions, 0) > 0
          AND ifNull(p.active_parts, 0) / ifNull(p.partitions, 1)
            >= ${PARTS_PER_PARTITION_WARNING},
          'Check merge backlog',
        ''
      )`

function safeInt(value: number, fallback: number): number {
  const n = Math.trunc(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function withMaxExecutionTime(sql: string, seconds: number): string {
  return `${sql}
    SETTINGS max_execution_time = ${seconds}`
}

/**
 * MergeTree tables + live part counts + recommend-only next step.
 * Shared by the inventory page, health scalar, and health detail.
 */
function ttlPartitionInventoryCtes(): string {
  return `mergetree_tables AS (
      SELECT
        database,
        name,
        engine,
        partition_key,
        engine_full
      FROM system.tables
      WHERE is_temporary = 0
        AND database NOT IN (${SYSTEM_DATABASES})
        AND positionCaseInsensitive(engine, 'MergeTree') > 0
    ),
    part_stats AS (
      SELECT
        database,
        table,
        uniqExact(partition) AS partitions,
        count() AS active_parts,
        if(
          uniqExact(partition) = 0,
          0,
          round(count() / uniqExact(partition), 2)
        ) AS parts_per_partition,
        sum(bytes_on_disk) AS bytes_on_disk,
        sum(rows) AS rows
      FROM system.parts
      WHERE active
        AND database NOT IN (${SYSTEM_DATABASES})
      GROUP BY database, table
    ),
    inventory AS (
      SELECT
        t.database,
        t.name AS table,
        concat(t.database, '.', t.name) AS full_table,
        t.database AS _database,
        t.name AS _table,
        t.engine,
        t.partition_key,
        ${TTL_FROM_ENGINE_FULL} AS ttl_expression,
        ${RECOMMENDATION_SQL} AS recommendation,
        ifNull(p.partitions, 0) AS partitions,
        ifNull(p.active_parts, 0) AS active_parts,
        ifNull(p.parts_per_partition, 0) AS parts_per_partition,
        ifNull(p.bytes_on_disk, 0) AS bytes_on_disk,
        ifNull(p.rows, 0) AS rows
      FROM mergetree_tables AS t
      LEFT JOIN part_stats AS p
        ON p.database = t.database AND p.table = t.name
    )`
}

/**
 * Full inventory for `/ttl-partition-health` (every MergeTree table).
 * Includes BackgroundBar pct_* columns and a Worker wall-clock cap.
 */
export function buildTtlPartitionInventorySql(opts?: {
  maxExecutionTime?: number
}): string {
  const maxExecutionTime = safeInt(
    opts?.maxExecutionTime ?? TTL_PARTITION_INVENTORY_MAX_EXECUTION_TIME,
    TTL_PARTITION_INVENTORY_MAX_EXECUTION_TIME
  )
  return withMaxExecutionTime(
    `WITH ${ttlPartitionInventoryCtes()},
    retention_keys AS (
      SELECT
        database,
        table,
        ${TTL_DAYS_SQL} AS ttl_days,
        ${TIME_BASED_PARTITION_SQL.replaceAll('t.partition_key', 'partition_key')} AS is_time_partition
      FROM inventory
    ),
    part_retention AS (
      SELECT
        p.database,
        p.table,
        any(k.ttl_days) AS ttl_days,
        sumIf(
          p.bytes_on_disk,
          k.ttl_days > 0
            AND k.is_time_partition
            AND p.max_date < today() - k.ttl_days
        ) AS bytes_past_ttl,
        sumIf(
          p.rows,
          k.ttl_days > 0
            AND k.is_time_partition
            AND p.max_date < today() - k.ttl_days
        ) AS rows_past_ttl
      FROM system.parts AS p
      INNER JOIN retention_keys AS k
        ON k.database = p.database AND k.table = p.table
      WHERE p.active
        AND p.database NOT IN (${SYSTEM_DATABASES})
      GROUP BY p.database, p.table
    )
    SELECT
      database,
      table,
      full_table,
      _database,
      _table,
      engine,
      partition_key,
      ttl_expression,
      recommendation,
      partitions,
      active_parts,
      parts_per_partition,
      bytes_on_disk,
      formatReadableSize(bytes_on_disk) AS readable_bytes_on_disk,
      round(
        bytes_on_disk * 100.0 / nullIf(max(bytes_on_disk) OVER (), 0),
        2
      ) AS pct_bytes_on_disk,
      round(
        partitions * 100.0 / nullIf(max(partitions) OVER (), 0),
        2
      ) AS pct_partitions,
      round(
        active_parts * 100.0 / nullIf(max(active_parts) OVER (), 0),
        2
      ) AS pct_active_parts,
      ifNull(r.ttl_days, 0) AS ttl_days,
      ifNull(r.bytes_past_ttl, 0) AS bytes_past_ttl,
      ifNull(r.rows_past_ttl, 0) AS rows_past_ttl,
      greatest(bytes_on_disk - ifNull(r.bytes_past_ttl, 0), 0) AS bytes_in_range,
      greatest(rows - ifNull(r.rows_past_ttl, 0), 0) AS rows_in_range,
      formatReadableSize(ifNull(r.bytes_past_ttl, 0)) AS readable_bytes_past_ttl,
      formatReadableSize(
        greatest(bytes_on_disk - ifNull(r.bytes_past_ttl, 0), 0)
      ) AS readable_bytes_in_range,
      formatReadableQuantity(ifNull(r.rows_past_ttl, 0)) AS readable_rows_past_ttl,
      formatReadableQuantity(
        greatest(rows - ifNull(r.rows_past_ttl, 0), 0)
      ) AS readable_rows_in_range,
      '' AS ttl_retention
    FROM inventory
    LEFT JOIN part_retention AS r
      ON r.database = inventory.database AND r.table = inventory.table
    ORDER BY partitions DESC, bytes_on_disk DESC`,
    maxExecutionTime
  )
}

/**
 * Scalar for the /health card + alert rule: count of MergeTree tables whose
 * recommend-only next step is non-empty (partition bloat, missing TTL on a
 * time-based key, or merge backlog). Higher-is-worse.
 */
export function buildTtlPartitionFlaggedCountSql(opts?: {
  maxExecutionTime?: number
}): string {
  const maxExecutionTime = safeInt(
    opts?.maxExecutionTime ?? TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME,
    TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME
  )
  return withMaxExecutionTime(
    `WITH ${ttlPartitionInventoryCtes()}
SELECT count() AS flagged_count
FROM inventory
WHERE recommendation != ''`,
    maxExecutionTime
  )
}

/**
 * Flagged tables for the health-detail dialog. Worst partition counts first.
 */
export function buildTtlPartitionHealthDetailSql(opts?: {
  limit?: number
  maxExecutionTime?: number
}): string {
  const limit = safeInt(opts?.limit ?? 20, 20)
  const maxExecutionTime = safeInt(
    opts?.maxExecutionTime ?? TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME,
    TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME
  )
  return withMaxExecutionTime(
    `WITH ${ttlPartitionInventoryCtes()}
SELECT
  full_table,
  partition_key,
  ttl_expression,
  partitions,
  active_parts,
  recommendation
FROM inventory
WHERE recommendation != ''
ORDER BY partitions DESC, active_parts DESC
LIMIT ${limit}`,
    maxExecutionTime
  )
}
