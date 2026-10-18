import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * system.latency_log — S3 and disk-S3 latency histograms, present on 25.3
 * and gone again by 25.8 (replaced by system.histogram_metrics).
 *
 * The table is wide: one `LatencyEvent_*` Array(UInt64) column per event, no
 * operation dimension. Each array holds cumulative bucket counts (the last
 * element is the total), and the counts run from server start, so the window
 * is the newest snapshot minus the oldest one in the last hour. Bucket upper
 * bounds come from system.latency_buckets (same column names); percentiles
 * are the bound of the first bucket that reaches the rank. Columns differ by
 * version, so both tables are unpivoted through COLUMNS('^LatencyEvent_').
 */
export const latencyLogConfig: QueryConfig = {
  name: 'latency-log',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['event_name'] },
  description:
    'Latency histograms per S3 and disk-S3 event over the last hour (system.latency_log, CH 25.3; replaced by system.histogram_metrics in 25.8). Percentiles are bucket upper bounds.',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.latency_log',
  sql: [
    {
      since: '25.3',
      description: 'Unpivot LatencyEvent_* histograms over the last hour',
      sql: `
        WITH
          per_host AS (
            SELECT
              kv.1 AS event,
              hostname,
              argMax(kv.2, event_time_microseconds) AS last_counts,
              argMin(kv.2, event_time_microseconds) AS first_counts
            FROM system.latency_log
            ARRAY JOIN JSONExtractKeysAndValues(
              formatRowNoNewline('JSONEachRow', COLUMNS('^LatencyEvent_')),
              'Array(UInt64)'
            ) AS kv
            WHERE event_time >= now() - INTERVAL 1 HOUR
            GROUP BY event, hostname
          ),
          windowed AS (
            SELECT
              event,
              sumForEach(
                arrayMap((a, b) -> toUInt64(a - if(a >= b, b, 0)), last_counts, first_counts)
              ) AS counts
            FROM per_host
            GROUP BY event
          ),
          bounds AS (
            SELECT kv.1 AS event, kv.2 AS bounds
            FROM system.latency_buckets
            ARRAY JOIN JSONExtractKeysAndValues(
              formatRowNoNewline('JSONEachRow', COLUMNS('^LatencyEvent_')),
              'Array(UInt64)'
            ) AS kv
          )
        SELECT
          replaceRegexpOne(w.event, '^LatencyEvent_', '') AS event_name,
          arrayElement(w.counts, -1) AS events,
          formatReadableQuantity(events) AS readable_events,
          round(events * 100.0 / nullIf(max(events) OVER (), 0), 2) AS pct_events,
          b.bounds[arrayFirstIndex(c -> c >= events * 0.50, w.counts)] AS p50_us,
          b.bounds[arrayFirstIndex(c -> c >= events * 0.95, w.counts)] AS p95_us,
          b.bounds[arrayFirstIndex(c -> c >= events * 0.99, w.counts)] AS p99_us
        FROM windowed AS w
        INNER JOIN bounds AS b ON b.event = w.event
        WHERE events > 0
        ORDER BY events DESC
        LIMIT 200
      `,
    },
  ],
  columns: ['event_name', 'readable_events', 'p50_us', 'p95_us', 'p99_us'],
  columnFormats: {
    event_name: ColumnFormat.ColoredBadge,
    readable_events: ColumnFormat.BackgroundBar,
  },
}
