/**
 * Traffic / Ingestion Charts
 * Charts answering "how much data is flowing into this cluster?" —
 * rows/bytes written over time, insert query counts, and a 24h KPI summary.
 *
 * Data sources:
 * - system.query_log (Insert queries): written_rows / written_bytes are the
 *   UNCOMPRESSED payload as ingested.
 * - system.part_log (NewPart events): size_in_bytes is the ON-DISK
 *   (compressed) size of each new part. part_log is opt-in, so every chart
 *   using it is marked optional with a tableCheck.
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const trafficCharts: Record<string, ChartQueryBuilder> = {
  /**
   * KPI summary: last 24h vs previous 24h ingestion totals from query_log.
   * Single-row result consumed by the /traffic KPI strip.
   */
  'traffic-summary': () => ({
    query: `
    SELECT
      sumIf(written_rows, recent) AS rows_24h,
      sumIf(written_rows, NOT recent) AS rows_prev_24h,
      sumIf(written_bytes, recent) AS bytes_24h,
      sumIf(written_bytes, NOT recent) AS bytes_prev_24h,
      countIf(recent) AS inserts_24h,
      countIf(NOT recent) AS inserts_prev_24h,
      formatReadableQuantity(rows_24h) AS readable_rows_24h,
      formatReadableSize(bytes_24h) AS readable_bytes_24h,
      formatReadableQuantity(inserts_24h) AS readable_inserts_24h
    FROM (
      SELECT
        written_rows,
        written_bytes,
        event_time >= now() - INTERVAL 24 HOUR AS recent
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND query_kind = 'Insert'
        AND event_time >= now() - INTERVAL 48 HOUR
    )
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  /**
   * Overall compression across active parts — how much smaller data is on
   * disk vs its raw (uncompressed) form. system.parts is always available.
   */
  'traffic-compression': () => ({
    query: `
    SELECT
      sum(data_compressed_bytes) AS compressed_bytes,
      sum(data_uncompressed_bytes) AS uncompressed_bytes,
      round(uncompressed_bytes / nullIf(compressed_bytes, 0), 2) AS compression_ratio,
      formatReadableSize(compressed_bytes) AS readable_compressed_bytes,
      formatReadableSize(uncompressed_bytes) AS readable_uncompressed_bytes
    FROM system.parts
    WHERE active
  `,
  }),

  /**
   * Rows ingested over time (uncompressed source of truth: query_log).
   */
  'traffic-inserted-rows': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(written_rows) AS inserted_rows,
           formatReadableQuantity(inserted_rows) AS readable_inserted_rows
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND query_kind = 'Insert'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.query_log',
    }
  },

  /**
   * Bytes ingested over time — uncompressed payload from query_log.
   */
  'traffic-inserted-bytes': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(written_bytes) AS inserted_bytes,
           formatReadableSize(inserted_bytes) AS readable_inserted_bytes
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND query_kind = 'Insert'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.query_log',
    }
  },

  /**
   * Bytes written to disk over time — compressed on-disk size of new parts
   * (part_log NewPart). Compare against traffic-inserted-bytes to read the
   * effective compression of incoming data.
   */
  'traffic-bytes-on-disk': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(size_in_bytes) AS bytes_on_disk,
           formatReadableSize(bytes_on_disk) AS readable_bytes_on_disk
    FROM system.part_log
    WHERE event_type = 'NewPart'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.part_log',
    }
  },

  /**
   * Insert query count over time, split by success/failure so ingestion
   * incidents are visible at a glance.
   */
  'traffic-insert-queries': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           countIf(type = 'QueryFinish') AS insert_queries,
           countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed_inserts
    FROM system.query_log
    WHERE query_kind = 'Insert'
      AND type != 'QueryStart'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.query_log',
    }
  },
}
