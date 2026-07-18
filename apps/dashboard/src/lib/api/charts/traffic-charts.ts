/**
 * Traffic / Ingestion Charts
 * Charts answering "how much data is flowing into this cluster?" —
 * rows/bytes written over time, insert query counts, a 24h KPI summary, plus
 * merges & data movement (merge volume, part moves, write amplification).
 *
 * Data sources:
 * - system.query_log (Insert queries): written_rows / written_bytes are the
 *   UNCOMPRESSED payload as ingested.
 * - system.part_log: NewPart size_in_bytes is the ON-DISK (compressed) size of
 *   each new part; MergeParts / MovePart events drive the merge and
 *   data-movement charts. part_log is opt-in, so every chart using it is marked
 *   optional with a tableCheck.
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const trafficCharts: Record<string, ChartQueryBuilder> = {
  /**
   * KPI summary: current window vs previous window ingestion totals from
   * query_log. Single-row result consumed by the /traffic KPI strip. The
   * window follows the global time-range picker via lastHours (default 24h).
   */
  'traffic-summary': ({ lastHours = 24 }) => {
    const hours = Math.max(1, Math.floor(Number(lastHours) || 24))
    return {
      query: `
    SELECT
      sumIf(written_rows, recent) AS rows_cur,
      sumIf(written_rows, NOT recent) AS rows_prev,
      sumIf(written_bytes, recent) AS bytes_cur,
      sumIf(written_bytes, NOT recent) AS bytes_prev,
      countIf(recent) AS inserts_cur,
      countIf(NOT recent) AS inserts_prev,
      formatReadableQuantity(rows_cur) AS readable_rows,
      formatReadableSize(bytes_cur) AS readable_bytes,
      formatReadableQuantity(inserts_cur) AS readable_inserts
    FROM (
      SELECT
        written_rows,
        written_bytes,
        event_time >= now() - INTERVAL ${hours} HOUR AS recent
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND query_kind = 'Insert'
        AND event_time >= now() - INTERVAL ${hours * 2} HOUR
    )
  `,
      optional: true,
      tableCheck: 'system.query_log',
    }
  },

  /**
   * part_log availability probe for /traffic smart-detection. part_log is
   * opt-in server config, so several sections (Bytes on Disk, Merges & Data
   * Movement, Top Tables) are meaningless without it. This cheap one-row query
   * exists to surface the data layer's `table_not_found` signal: when part_log
   * is absent the API responds with `metadata.unavailable`, and the page
   * replaces those sections with a single "enable part_log" callout instead of
   * a wall of empty cards.
   */
  'traffic-part-log-detect': () => ({
    query: `
    SELECT count() AS recent_part_events
    FROM system.part_log
    WHERE event_time >= now() - INTERVAL 24 HOUR
  `,
    optional: true,
    tableCheck: 'system.part_log',
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

  /**
   * Insert (write) performance over time — average and p95 duration of
   * successful insert queries, so slow-ingest regressions are visible next to
   * the insert volume charts.
   */
  'traffic-insert-performance': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           round(avg(query_duration_ms), 1) AS avg_duration_ms,
           round(quantile(0.95)(query_duration_ms), 1) AS p95_duration_ms
    FROM system.query_log
    WHERE query_kind = 'Insert'
      AND type = 'QueryFinish'
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
   * Data merged over time — total on-disk size of parts produced by merges
   * (part_log MergeParts). High merge volume is background write work that
   * competes with ingestion for disk and CPU.
   */
  'traffic-merged-bytes': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(size_in_bytes) AS merged_bytes,
           sum(rows) AS merged_rows,
           count() AS merges,
           formatReadableSize(merged_bytes) AS readable_merged_bytes
    FROM system.part_log
    WHERE event_type = 'MergeParts'
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
   * Part moves over time — count and size of parts relocated across volumes
   * (part_log MovePart), e.g. TTL-driven moves to cold storage. Spikes signal
   * tiered-storage churn.
   */
  'traffic-part-moves': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           count() AS moves,
           sum(size_in_bytes) AS moved_bytes,
           formatReadableSize(moved_bytes) AS readable_moved_bytes
    FROM system.part_log
    WHERE event_type = 'MovePart'
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
   * Write amplification over time — bytes merged ÷ bytes newly written per
   * bucket (part_log MergeParts vs NewPart). A ratio well above 1 means the
   * cluster rewrites much more than it ingests; useful for spotting overly
   * aggressive merges or small-insert patterns.
   */
  'traffic-write-amplification': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           round(sumIf(size_in_bytes, event_type = 'MergeParts')
             / nullIf(sumIf(size_in_bytes, event_type = 'NewPart'), 0), 2) AS write_amplification
    FROM system.part_log
    WHERE event_type IN ('NewPart', 'MergeParts')
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
   * Cluster shape detection — a single cheap one-row probe of the core
   * system.replicas / system.clusters tables. Powers the /traffic page's
   * smart-detection: the "Replication & Distribution" section is rendered only
   * when the cluster actually replicates (replicated_tables > 0), and the
   * shard-related charts only when it actually shards (max_shards > 1). Both
   * source tables are always present, so this needs no tableCheck.
   */
  'traffic-cluster-shape': () => ({
    query: `
    SELECT
      (SELECT count() FROM system.replicas) AS replicated_tables,
      (SELECT max(total_replicas) FROM system.replicas) AS max_replicas,
      (SELECT count(DISTINCT cluster) FROM system.clusters) AS clusters,
      (SELECT max(shard_num) FROM system.clusters) AS max_shards
  `,
  }),

  /**
   * Replica fetch traffic — inbound replication volume: parts this replica
   * downloaded from other replicas (part_log DownloadPart). Non-zero only on a
   * replicated cluster; part_log is opt-in, hence optional + tableCheck.
   */
  'traffic-replica-fetches': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           count() AS fetched_parts,
           sum(size_in_bytes) AS fetched_bytes,
           formatReadableSize(fetched_bytes) AS readable_fetched_bytes
    FROM system.part_log
    WHERE event_type = 'DownloadPart'
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
   * Distributed query fan-out — initial (client-facing) vs secondary
   * (shard-local, fanned-out by a Distributed table) queries over time. The
   * secondary count is only meaningful on a sharded cluster.
   */
  'traffic-distributed-queries': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           countIf(is_initial_query) AS initial_queries,
           countIf(NOT is_initial_query) AS secondary_queries
    FROM system.query_log
    WHERE type = 'QueryFinish'
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
   * PeerDB smart-detection: a single row reporting whether this cluster is used
   * as a PeerDB (Postgres CDC → ClickHouse) destination. PeerDB creates helper
   * tables/databases whose names contain 'peerdb' and runs its insert queries
   * under a user/client containing 'peerdb'. Powers the conditional "PeerDB
   * Ingestion" section on /traffic — that section renders only when either
   * count is > 0, so it stays hidden entirely when PeerDB is not in use.
   */
  'traffic-peerdb-detect': () => ({
    query: `
    SELECT
      (SELECT count() FROM system.tables WHERE database ILIKE '%peerdb%' OR name ILIKE '%peerdb%') AS peerdb_tables,
      (SELECT count() FROM system.query_log
        WHERE type = 'QueryFinish' AND query_kind = 'Insert'
          AND event_time >= now() - INTERVAL 24 HOUR
          AND (user ILIKE '%peerdb%' OR http_user_agent ILIKE '%peerdb%' OR client_name ILIKE '%peerdb%')) AS peerdb_inserts_24h
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  /**
   * Rows ingested by PeerDB over time, split by destination table. Only counts
   * insert queries attributable to PeerDB (user/agent/client contains 'peerdb').
   * `tables` is an Array column on query_log; we key on the first element,
   * which is the fully-qualified `db.table` name — simpler and more robust than
   * reconstructing it from `databases` + `tables`.
   */
  'traffic-peerdb-rows': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           arrayElement(tables, 1) AS table,
           sum(written_rows) AS peerdb_rows
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND query_kind = 'Insert'
      AND (user ILIKE '%peerdb%' OR http_user_agent ILIKE '%peerdb%' OR client_name ILIKE '%peerdb%')
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `,
      optional: true,
      tableCheck: 'system.query_log',
    }
  },
}
