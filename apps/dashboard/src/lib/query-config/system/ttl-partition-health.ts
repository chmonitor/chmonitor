import type { QueryConfig } from '@/types/query-config'

import { ttlPartitionRowClassName } from '@/lib/health/ttl-partition-heuristics'
import { ColumnFormat } from '@/types/column-format'

/**
 * Inventory of MergeTree TTL + PARTITION BY + live part counts.
 *
 * Reads system.tables + system.parts only — does not need system.part_log.
 * Older ClickHouse builds have no `system.tables.ttl`; those variants parse
 * `create_table_query` instead. Tables with no TTL still appear.
 */

const TTL_FROM_CREATE = `
      if(
        positionCaseInsensitive(t.create_table_query, ' TTL ') > 0,
        trim(BOTH ' ' FROM replaceRegexpOne(
          substring(
            t.create_table_query,
            positionCaseInsensitive(t.create_table_query, ' TTL ') + 5
          ),
          '\\\\s+(SETTINGS|COMMENT)\\\\s+.*$',
          ''
        )),
        ''
      )`

const TTL_FROM_COLUMN = `ifNull(nullIf(t.ttl, ''), ${TTL_FROM_CREATE})`

function inventorySql(ttlExpressionSql: string): string {
  return `
    WITH part_stats AS (
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
      ${ttlExpressionSql} AS ttl_expression,
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
    FROM system.tables AS t
    LEFT JOIN part_stats AS p
      ON p.database = t.database AND p.table = t.name
    WHERE t.is_temporary = 0
      AND t.database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
      AND positionCaseInsensitive(t.engine, 'MergeTree') > 0
    ORDER BY partitions DESC, bytes_on_disk DESC
  `
}

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
  sql: [
    {
      since: '19.1',
      description: 'TTL parsed from CREATE TABLE (no system.tables.ttl)',
      sql: inventorySql(TTL_FROM_CREATE),
    },
    {
      since: '21.8',
      description: 'Prefer system.tables.ttl; fall back to CREATE TABLE',
      sql: inventorySql(TTL_FROM_COLUMN),
    },
  ],
  columns: [
    'full_table',
    'engine',
    'partition_key',
    'ttl_expression',
    'partitions',
    'active_parts',
    'parts_per_partition',
    'readable_bytes_on_disk',
  ],
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
