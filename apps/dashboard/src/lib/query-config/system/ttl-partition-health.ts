import type { QueryConfig } from '@/types/query-config'

import {
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
  PARTS_PER_PARTITION_WARNING,
  ttlPartitionRowClassName,
} from '@/lib/health/ttl-partition-heuristics'
import { ColumnFormat } from '@/types/column-format'

/**
 * Inventory of MergeTree TTL + PARTITION BY + live part counts.
 *
 * Reads system.tables + system.parts only — does not need system.part_log.
 * Table-level TTL is parsed from `engine_full` (the engine clause), not
 * `create_table_query` (full CREATE TEXT, too heavy on the cloud demo) and
 * not `system.tables.ttl` (that column does not exist — #3121).
 * Tables with no TTL still appear.
 */

const SYSTEM_DATABASES = `'system', 'INFORMATION_SCHEMA', 'information_schema'`

/**
 * Table TTL is the clause after ` TTL ` in engine_full, before SETTINGS.
 * engine_full is far cheaper than create_table_query (no column list).
 */
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
export const ttlPartitionInventorySql = `
    WITH mergetree_tables AS (
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
        sum(bytes_on_disk) AS bytes_on_disk
      FROM system.parts
      WHERE active
        AND database NOT IN (${SYSTEM_DATABASES})
      GROUP BY database, table
    )
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
      formatReadableSize(ifNull(p.bytes_on_disk, 0)) AS readable_bytes_on_disk,
      round(
        ifNull(p.bytes_on_disk, 0) * 100.0
          / nullIf(max(ifNull(p.bytes_on_disk, 0)) OVER (), 0),
        2
      ) AS pct_bytes_on_disk,
      round(
        ifNull(p.partitions, 0) * 100.0
          / nullIf(max(ifNull(p.partitions, 0)) OVER (), 0),
        2
      ) AS pct_partitions,
      round(
        ifNull(p.active_parts, 0) * 100.0
          / nullIf(max(ifNull(p.active_parts, 0)) OVER (), 0),
        2
      ) AS pct_active_parts
    FROM mergetree_tables AS t
    LEFT JOIN part_stats AS p
      ON p.database = t.database AND p.table = t.name
    ORDER BY partitions DESC, bytes_on_disk DESC
    SETTINGS max_execution_time = 25
  `

export const ttlPartitionHealthConfig: QueryConfig = {
  name: 'ttl-partition-health',
  defaultView: 'auto',
  card: {
    primary: 'full_table',
    badges: ['engine'],
    metrics: ['partitions', 'active_parts', 'readable_bytes_on_disk'],
  },
  description:
    'TTL expression, PARTITION BY, and partition/part counts per MergeTree table. Does not apply ALTER TTL or DROP PARTITION.',
  docs: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-ttl',
  tableCheck: 'system.parts',
  sql: ttlPartitionInventorySql,
  columns: [
    'full_table',
    'engine',
    'partition_key',
    'ttl_expression',
    'recommendation',
    'partitions',
    'active_parts',
    'parts_per_partition',
    'readable_bytes_on_disk',
  ],
  columnDescriptions: {
    ttl_expression:
      'Table-level TTL from engine_full. Empty means no table TTL.',
    recommendation:
      'Recommend-only next step: add TTL, coarsen PARTITION BY, or check merges. Never applied from this page.',
    partition_key: 'PARTITION BY expression.',
    partitions:
      'Active partition count. Highlighted rows have 500+ partitions or a time-based key with no TTL.',
    parts_per_partition:
      'Active parts divided by partitions. High values mean merge backlog.',
  },
  columnFormats: {
    full_table: [
      ColumnFormat.Link,
      {
        href: '/table?host=[ctx.hostId]&database=[_database]&table=[_table]',
      },
    ],
    engine: ColumnFormat.ColoredBadge,
    partition_key: ColumnFormat.Code,
    ttl_expression: ColumnFormat.Code,
    recommendation: ColumnFormat.Text,
    partitions: ColumnFormat.BackgroundBar,
    active_parts: ColumnFormat.BackgroundBar,
    readable_bytes_on_disk: ColumnFormat.BackgroundBar,
  },
  relatedCharts: [
    ['partition-part-health', { title: 'Part health' }],
    ['parts-per-table', { title: 'Parts per table' }],
  ],
  rowClassName: ttlPartitionRowClassName,
}
