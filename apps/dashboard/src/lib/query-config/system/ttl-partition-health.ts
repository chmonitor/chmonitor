import type { QueryConfig } from '@/types/query-config'

import { ttlPartitionRowClassName } from '@/lib/health/ttl-partition-heuristics'
import { buildTtlPartitionInventorySql } from '@/lib/health/ttl-partition-sql'
import { ColumnFormat } from '@/types/column-format'

/**
 * Inventory of MergeTree TTL + PARTITION BY + live part counts.
 *
 * SQL lives in ttl-partition-sql.ts (shared with the /health check).
 * Reads system.tables + system.parts only — does not need system.part_log.
 * Table-level TTL is parsed from `engine_full` (the engine clause), not
 * `create_table_query` (full CREATE TEXT, too heavy on the cloud demo) and
 * not `system.tables.ttl` (that column does not exist — #3121).
 * Tables with no TTL still appear.
 */

export const ttlPartitionInventorySql = buildTtlPartitionInventorySql()

export const ttlPartitionHealthConfig: QueryConfig = {
  name: 'ttl-partition-health',
  defaultView: 'auto',
  card: {
    primary: 'full_table',
    badges: ['engine'],
    metrics: [
      'partitions',
      'active_parts',
      'readable_bytes_on_disk',
      'readable_bytes_past_ttl',
    ],
  },
  description:
    'TTL expression, PARTITION BY, partition/part counts, and in-range vs past-TTL bytes per MergeTree table. Does not apply ALTER TTL or DROP PARTITION.',
  docs: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-ttl', // pragma: allowlist secret
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
    'ttl_retention',
    'readable_bytes_past_ttl',
    'readable_rows_past_ttl',
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
    ttl_retention:
      'Bytes still inside the parsed TTL window vs parts whose max_date is already past it. Estimate from system.parts — recommend-only, never DROP PARTITION.',
    readable_bytes_past_ttl:
      'On-disk bytes in parts whose newest row date is older than the TTL window.',
    readable_rows_past_ttl: 'Rows in those past-TTL parts.',
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
    ttl_retention: ColumnFormat.StackedShare,
  },
  relatedCharts: [
    ['partition-part-health', { title: 'Part health' }],
    ['parts-per-table', { title: 'Parts per table' }],
  ],
  rowClassName: ttlPartitionRowClassName,
}
