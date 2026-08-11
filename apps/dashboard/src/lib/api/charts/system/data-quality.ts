/**
 * Data freshness, compression, and top-memory-query charts.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import { type ChartQueryBuilder, buildTimeFilter } from '../types'

export const dataQualityCharts: Record<string, ChartQueryBuilder> = {
  'data-freshness': () => ({
    query: `
    WITH latest_data AS (
      SELECT
        database,
        table,
        concat(database, '.', table) AS table_path,
        max(modification_time) AS latest_part_time,
        count() AS active_parts,
        sum(rows) AS total_rows,
        dateDiff('second', latest_part_time, now()) AS staleness_seconds
      FROM system.parts
      WHERE active = 1
        AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      GROUP BY database, table
    )
    SELECT
      table_path,
      latest_part_time,
      staleness_seconds,
      formatReadableTimeDelta(staleness_seconds) AS readable_staleness,
      active_parts,
      formatReadableQuantity(total_rows) AS readable_rows
    FROM latest_data
    ORDER BY staleness_seconds DESC, database ASC, table ASC
    LIMIT 20`,
  }),

  'compression-ratio': () => ({
    query: `
    SELECT
      concat(database, '.', table) AS table_path,
      sum(data_compressed_bytes) AS compressed_bytes,
      sum(data_uncompressed_bytes) AS uncompressed_bytes,
      formatReadableSize(compressed_bytes) AS compressed_size,
      formatReadableSize(uncompressed_bytes) AS uncompressed_size,
      round(uncompressed_bytes / nullIf(compressed_bytes, 0), 2) AS compression_ratio,
      formatReadableQuantity(sum(rows)) AS readable_rows
    FROM system.parts
    WHERE active = 1
      AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
    GROUP BY database, table
    HAVING compressed_bytes > 0
    ORDER BY compression_ratio ASC, table_path ASC
    LIMIT 20`,
  }),

  'top-memory-queries': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        normalized_query_hash,
        any(substring(query, 1, 120)) AS query_preview,
        any(query) AS full_query,
        count() AS execution_count,
        max(memory_usage) AS peak_memory,
        formatReadableSize(max(memory_usage)) AS readable_peak_memory,
        avg(memory_usage) AS avg_memory,
        formatReadableSize(avg(memory_usage)) AS readable_avg_memory
      FROM system.query_log
      WHERE type = 'QueryFinish'
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY normalized_query_hash
      ORDER BY peak_memory DESC
      LIMIT 15
    `,
    }
  },

  // NOTE: 'replication-lag' is defined in replication-charts.ts (authoritative)

}
