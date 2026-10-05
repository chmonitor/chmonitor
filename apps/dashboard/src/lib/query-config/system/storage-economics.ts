import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * Per-table compression and storage cost analysis.
 *
 * Uses system.parts (active parts only) to compute:
 * - Compressed / uncompressed bytes and compression ratio
 * - Total bytes on disk (may exceed uncompressed due to metadata / indices)
 * - Top tables by storage cost
 *
 * Higher compression_ratio means data compresses well (less disk needed).
 *
 * The `compression_ratio` numerator/denominator are qualified as
 * `parts.data_uncompressed_bytes` / `parts.data_compressed_bytes`. The bare
 * spelling is substituted with the sibling aliases of the same names, which
 * nests an aggregate inside an aggregate and fails with
 * `Code: 184 ILLEGAL_AGGREGATION` on every ClickHouse whose analyzer is on
 * (24.3+). The qualifier leaves the OUTPUT column names unchanged, so
 * `columns`/`columnFormats`/`sortingFns` below are unaffected. Guarded by
 * `__tests__/alias-shadowing.test.ts`.
 */
export const storageCompressionConfig: QueryConfig = {
  name: 'storage-compression',
  description:
    'Per-table compression ratios and storage cost from active parts in system.parts',
  sql: `
    WITH agg AS (
      SELECT
        database,
        table,
        database || '.' || table AS full_table,
        count() AS parts,
        sum(rows) AS rows,
        sum(data_compressed_bytes) AS data_compressed_bytes,
        sum(data_uncompressed_bytes) AS data_uncompressed_bytes,
        round(
          sum(parts.data_uncompressed_bytes) / nullIf(sum(parts.data_compressed_bytes), 0),
          2
        ) AS compression_ratio,
        sum(bytes_on_disk) AS bytes_on_disk
      FROM system.parts
      WHERE active = 1
      GROUP BY database, table
    )
    SELECT
      full_table,
      parts,
      rows,
      formatReadableQuantity(rows) AS readable_rows,
      round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
      data_compressed_bytes,
      formatReadableSize(data_compressed_bytes) AS readable_compressed,
      round(
        data_compressed_bytes * 100.0 / nullIf(max(data_compressed_bytes) OVER (), 0),
        2
      ) AS pct_compressed,
      data_uncompressed_bytes,
      formatReadableSize(data_uncompressed_bytes) AS readable_uncompressed,
      round(
        data_uncompressed_bytes * 100.0 / nullIf(max(data_uncompressed_bytes) OVER (), 0),
        2
      ) AS pct_uncompressed,
      compression_ratio,
      round(
        compression_ratio * 100.0 / nullIf(max(compression_ratio) OVER (), 0),
        2
      ) AS pct_compression_ratio,
      bytes_on_disk,
      formatReadableSize(bytes_on_disk) AS readable_bytes_on_disk,
      round(
        bytes_on_disk * 100.0 / nullIf(max(bytes_on_disk) OVER (), 0),
        2
      ) AS pct_bytes_on_disk
    FROM agg
    ORDER BY data_compressed_bytes DESC
  `,
  columns: [
    'full_table',
    'parts',
    'readable_rows',
    'readable_compressed',
    'readable_uncompressed',
    'compression_ratio',
    'readable_bytes_on_disk',
  ],
  columnFormats: {
    full_table: ColumnFormat.ColoredBadge,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_compressed: ColumnFormat.BackgroundBar,
    readable_uncompressed: ColumnFormat.BackgroundBar,
    compression_ratio: ColumnFormat.BackgroundBar,
    readable_bytes_on_disk: ColumnFormat.BackgroundBar,
  },
  sortingFns: {
    readable_rows: 'sort_column_using_actual_value',
    readable_compressed: 'sort_column_using_actual_value',
    readable_uncompressed: 'sort_column_using_actual_value',
    readable_bytes_on_disk: 'sort_column_using_actual_value',
  },
}

/**
 * Storage policy and volume tier configuration.
 *
 * Uses system.storage_policies to show which disks are assigned to each
 * volume and what limits apply, enabling tiered-storage audits.
 */
export const storagePoliciesConfig: QueryConfig = {
  name: 'storage-policies',
  description:
    'Storage policies and volume configurations from system.storage_policies',
  sql: `
    SELECT
      policy_name,
      volume_name,
      volume_priority,
      arrayStringConcat(disks, ', ') AS disk_list,
      max_data_part_size,
      if(
        max_data_part_size > 0,
        formatReadableSize(max_data_part_size),
        '∞'
      ) AS readable_max_part_size,
      move_factor,
      prefer_not_to_merge,
      perform_ttl_move_on_insert
    FROM system.storage_policies
    ORDER BY policy_name, volume_priority
  `,
  columns: [
    'policy_name',
    'volume_name',
    'volume_priority',
    'disk_list',
    'readable_max_part_size',
    'move_factor',
    'prefer_not_to_merge',
    'perform_ttl_move_on_insert',
  ],
  columnFormats: {
    policy_name: ColumnFormat.ColoredBadge,
    prefer_not_to_merge: ColumnFormat.Boolean,
    perform_ttl_move_on_insert: ColumnFormat.Boolean,
  },
}

/**
 * TTL-triggered part move activity.
 *
 * Filters system.part_log for MovePart events (event_type = 6) to show
 * which tables are actively moving data between storage tiers via TTL rules.
 * Requires system.part_log to be enabled.
 */
export const ttlStorageMovesConfig: QueryConfig = {
  name: 'ttl-storage-moves',
  defaultView: 'auto',
  card: { primary: 'part_name', badges: ['event_type', 'disk_name'] },
  description:
    'Part moves triggered by TTL storage policies, from system.part_log',
  optional: true,
  tableCheck: 'system.part_log',
  sql: `
    SELECT
      event_time,
      database || '.' || table AS full_table,
      part_name,
      partition_id,
      disk_name,
      size_in_bytes,
      formatReadableSize(size_in_bytes) AS readable_size,
      round(
        size_in_bytes * 100.0 / nullIf(max(size_in_bytes) OVER (), 0),
        2
      ) AS pct_size,
      rows,
      formatReadableQuantity(rows) AS readable_rows,
      round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
      duration_ms,
      formatReadableTimeDelta(duration_ms / 1000) AS readable_duration,
      round(duration_ms * 100.0 / nullIf(max(duration_ms) OVER (), 0), 2) AS pct_duration,
      error,
      exception
    FROM system.part_log
    WHERE toInt8(event_type) = 6
    ORDER BY event_time DESC
    LIMIT 500
  `,
  columns: [
    'event_time',
    'full_table',
    'part_name',
    'partition_id',
    'disk_name',
    'readable_size',
    'readable_rows',
    'readable_duration',
    'error',
    'exception',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    full_table: ColumnFormat.ColoredBadge,
    part_name: ColumnFormat.Code,
    disk_name: ColumnFormat.ColoredBadge,
    readable_size: ColumnFormat.BackgroundBar,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_duration: ColumnFormat.BackgroundBar,
    exception: ColumnFormat.CodeDialog,
  },
  rowClassName: (row) => {
    if (row.error && Number(row.error) !== 0)
      return 'bg-red-50 dark:bg-red-950/20'
    return ''
  },
}
