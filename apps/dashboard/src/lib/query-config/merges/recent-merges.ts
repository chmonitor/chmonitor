import type { QueryConfig } from '@/types/query-config'

import { PART_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Recently COMPLETED merges, from system.part_log.
 *
 * Companion to `mergesConfig`, which reads system.merges — and system.merges
 * only ever holds merges that are running RIGHT NOW. On any cluster that is not
 * mid-merge that table is empty, which is correct ClickHouse behaviour but
 * leaves the Merges page with nothing to show; that emptiness was reported as
 * the page being broken. This config is what the page falls back to, so an idle
 * cluster still answers "what has this cluster been merging?".
 *
 * `optional: true` + `tableCheck` matter here: part_log is opt-in server config
 * (`<part_log>`), so it is absent on plenty of self-hosted installs. The
 * fallback must degrade to a note, never take the live table down with it.
 */
export const recentMergesConfig: QueryConfig = {
  name: 'recent-merges',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['merge_reason'] },
  description:
    'Merges completed recently, from system.part_log (system.merges only lists merges still in progress)',
  docs: PART_LOG,
  tableCheck: 'system.part_log',
  optional: true,
  // Version-aware queries (oldest → newest).
  // The base branch sticks to long-standing part_log columns. 23.8 adds the
  // two this page also likes to show; they are stubbed below that so an older
  // server degrades to blank cells instead of an unknown-identifier error.
  sql: [
    {
      since: '19.1',
      description: 'Base query — merge_algorithm / peak_memory_usage stubbed',
      sql: `
        SELECT
          database || '.' || table AS table,
          event_time,
          part_name,
          partition_id,
          merge_reason,
          '' AS merge_algorithm,
          duration_ms,
          formatReadableTimeDelta(duration_ms / 1000, 'minutes', 'milliseconds') AS readable_duration,
          round(100 * duration_ms / nullIf(max(duration_ms) OVER (), 0)) AS pct_duration,
          rows,
          formatReadableQuantity(rows) AS readable_rows,
          round(100 * rows / nullIf(max(rows) OVER (), 0)) AS pct_rows,
          size_in_bytes,
          formatReadableSize(size_in_bytes) AS readable_size_in_bytes,
          round(100 * size_in_bytes / nullIf(max(size_in_bytes) OVER (), 0)) AS pct_size_in_bytes,
          read_rows,
          formatReadableQuantity(read_rows) AS readable_read_rows,
          toUInt64(0) AS peak_memory_usage,
          '' AS readable_peak_memory_usage,
          length(merged_from) AS parts_merged,
          error
        FROM system.part_log
        WHERE toInt8(event_type) = 2
          AND event_time >= now() - INTERVAL {lastHours:UInt32} HOUR
        ORDER BY event_time DESC
        LIMIT 1000
      `,
    },
    {
      since: '23.8',
      description: 'Includes merge_algorithm and peak_memory_usage',
      sql: `
        SELECT
          database || '.' || table AS table,
          event_time,
          part_name,
          partition_id,
          merge_reason,
          merge_algorithm,
          duration_ms,
          formatReadableTimeDelta(duration_ms / 1000, 'minutes', 'milliseconds') AS readable_duration,
          round(100 * duration_ms / nullIf(max(duration_ms) OVER (), 0)) AS pct_duration,
          rows,
          formatReadableQuantity(rows) AS readable_rows,
          round(100 * rows / nullIf(max(rows) OVER (), 0)) AS pct_rows,
          size_in_bytes,
          formatReadableSize(size_in_bytes) AS readable_size_in_bytes,
          round(100 * size_in_bytes / nullIf(max(size_in_bytes) OVER (), 0)) AS pct_size_in_bytes,
          read_rows,
          formatReadableQuantity(read_rows) AS readable_read_rows,
          peak_memory_usage,
          formatReadableSize(peak_memory_usage) AS readable_peak_memory_usage,
          length(merged_from) AS parts_merged,
          error
        FROM system.part_log
        WHERE toInt8(event_type) = 2
          AND event_time >= now() - INTERVAL {lastHours:UInt32} HOUR
        ORDER BY event_time DESC
        LIMIT 1000
      `,
    },
  ],
  columns: [
    'table',
    'event_time',
    'readable_duration',
    'parts_merged',
    'readable_rows',
    'readable_size_in_bytes',
    'readable_read_rows',
    'readable_peak_memory_usage',
    'merge_reason',
    'merge_algorithm',
    'part_name',
  ],
  columnFormats: {
    table: ColumnFormat.ColoredBadge,
    event_time: ColumnFormat.RelatedTime,
    readable_duration: ColumnFormat.BackgroundBar,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_size_in_bytes: ColumnFormat.BackgroundBar,
    parts_merged: ColumnFormat.Number,
    part_name: ColumnFormat.Code,
  },
  defaultParams: {
    lastHours: 24,
  },
  relatedCharts: [],
}
