/**
 * Disk size, usage, IO throughput, storage policy, and table/part charts.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import {
  applyInterval,
  buildTimeFilterInterval,
  type ChartQueryBuilder,
} from '../types'
import { METRICS_PERMISSION } from './permissions'

export const diskCharts: Record<string, ChartQueryBuilder> = {
  'disk-size': ({ params }) => {
    const name = params?.name as string | undefined
    // Sanitize disk name: allow only alphanumeric, underscore, hyphen
    const safeName = name && /^[\w-]+$/.test(name) ? name : undefined
    const condition = safeName ? `WHERE name = '${safeName}'` : ''
    return {
      query: `
    SELECT name,
           type,
           (total_space - unreserved_space) AS used_space,
           formatReadableSize(used_space) AS readable_used_space,
           total_space,
           formatReadableSize(total_space) AS readable_total_space
    FROM system.disks
    ${condition}
    ORDER BY name
  `,
      permission: METRICS_PERMISSION,
    }
  },

  'disks-usage': ({ interval = 'toStartOfDay', lastHours = 24 * 30 }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
    WITH CAST(sumMap(map(metric, value)), 'Map(LowCardinality(String), UInt32)') AS map
    SELECT
        ${applyInterval(interval, 'event_time')},
        map['DiskAvailable_default'] as DiskAvailable_default,
        map['DiskUsed_default'] as DiskUsed_default,
        formatReadableSize(DiskAvailable_default) as readable_DiskAvailable_default,
        formatReadableSize(DiskUsed_default) as readable_DiskUsed_default
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('DiskAvailable_default', 'DiskUsed_default')
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC
  `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'disk-usage-trend': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
    SELECT
        ${applyInterval(interval, 'event_time')},
        metric,
        avg(value) AS usage
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric LIKE 'DiskUsed_%'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1, metric
    ORDER BY 1 ASC
  `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'disk-usage-by-database': () => ({
    query: `
    SELECT
      database,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size,
      sum(rows) AS total_rows,
      formatReadableQuantity(total_rows) AS readable_rows,
      count() AS part_count
    FROM system.parts
    WHERE active
    GROUP BY database
    ORDER BY total_bytes DESC
  `,
  }),

  'disk-io-throughput': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        metric,
        avg(value) AS avg_value
      FROM merge('system', '^asynchronous_metric_log')
      WHERE metric IN ('OSReadBytes', 'OSWriteBytes')
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1, metric
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
    }
  },

  'storage-policies': () => ({
    query: `
    SELECT
      policy_name,
      volume_name,
      disks,
      volume_priority,
      prefer_not_to_merge
    FROM system.storage_policies
    ORDER BY policy_name, volume_priority
  `,
  }),
  'top-table-size': ({ params }) => {
    const rawLimit = Number(params?.limit)
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100
        ? rawLimit
        : 7
    return {
      query: `
      SELECT
        (database || '.' || table) as table,
        sum(data_compressed_bytes) as compressed_bytes,
        sum(data_uncompressed_bytes) AS uncompressed_bytes,
        formatReadableSize(compressed_bytes) AS compressed,
        formatReadableSize(uncompressed_bytes) AS uncompressed,
        round(uncompressed_bytes / compressed_bytes, 2) AS compr_rate,
        sum(rows) AS total_rows,
        formatReadableQuantity(total_rows) AS readable_total_rows,
        count() AS part_count
    FROM system.parts
    WHERE (active = 1) AND (database != 'system') AND (table LIKE '%')
    GROUP BY 1
    ORDER BY compressed_bytes DESC
    LIMIT ${limit}`,
    }
  },

  'parts-per-table': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      count() AS part_count,
      formatReadableQuantity(part_count) AS readable_part_count,
      sum(rows) AS total_rows,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size
    FROM system.parts
    WHERE active
    GROUP BY database, table
    ORDER BY part_count DESC
    LIMIT 20`,
  }),

  'partition-part-health': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      partition,
      count() AS part_count,
      formatReadableQuantity(part_count) AS readable_part_count,
      sum(rows) AS total_rows,
      formatReadableQuantity(total_rows) AS readable_rows,
      sum(bytes_on_disk) AS total_bytes,
      formatReadableSize(total_bytes) AS readable_size
    FROM system.parts
    WHERE active
      AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    GROUP BY database, table, partition
    HAVING part_count > 50
    ORDER BY part_count DESC
    LIMIT 30
  `,
  }),

  'partition-part-health-summary': () => ({
    query: `
    SELECT
      countIf(active) AS active_parts,
      formatReadableQuantity(active_parts) AS readable_active_parts,
      countIf(NOT active) AS outdated_parts,
      uniqExactIf((database, table, partition), active) AS partitions,
      round(active_parts / nullIf(partitions, 0), 1) AS avg_parts_per_partition
    FROM system.parts
  `,
  }),
}
