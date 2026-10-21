/**
 * Per-table retention forecast: pure classifier + row-to-insight mapping.
 *
 * No I/O. The SQL lives in `retention-forecast-collector.ts`.
 *
 * Background (#4069, slice 2): when one table without a TTL dominates ingest
 * and already holds a large share of the disk, its growth is the growth of the
 * host. This surfaces that table and what its older data weighs, so the table
 * owner can decide on a retention policy. It is a forecast from the
 * `system.part_log` window, never a recommendation to delete.
 */

import type { InsightCandidate } from './types'

import { formatReadableSize } from '../format-readable'

const GIB = 1024 ** 3

/** Share of the total ingest (all non-system tables) a table must account for. */
export const RETENTION_MIN_INGEST_SHARE = 0.5
/** Current on-disk size a table must reach to be worth a retention discussion. */
export const RETENTION_MIN_DISK_BYTES = 100 * GIB
/** Upper bound of the `system.part_log` look-back (it may hold less). */
export const RETENTION_WINDOW_DAYS = 30

export interface RetentionForecastRow {
  database: string
  table: string
  /** Sum of `NewPart` `size_in_bytes` for this table in the window. */
  ingestBytes: number
  /** Same sum over every non-system table. */
  totalIngestBytes: number
  /** Days of `part_log` actually available, at most {@link RETENTION_WINDOW_DAYS}. */
  windowDays: number
  /** Active parts on disk now. */
  diskBytes: number
  /** Active bytes in parts whose newest row is older than 12 / 24 / 36 months. */
  olderThan12mBytes: number
  olderThan24mBytes: number
  olderThan36mBytes: number
  /** `engine_full` has a TTL clause. */
  hasTtl: boolean
}

export interface RetentionForecastVerdict {
  flagged: boolean
  /** 0..1; 0 when there is no ingest at all. */
  share: number
  avgIngestPerDay: number
}

export function classifyRetentionForecast(
  row: RetentionForecastRow
): RetentionForecastVerdict {
  const share =
    row.totalIngestBytes > 0 ? row.ingestBytes / row.totalIngestBytes : 0
  const avgIngestPerDay = row.ingestBytes / Math.max(row.windowDays, 1)
  const flagged =
    !row.hasTtl &&
    share >= RETENTION_MIN_INGEST_SHARE &&
    row.diskBytes >= RETENTION_MIN_DISK_BYTES
  return { flagged, share, avgIngestPerDay }
}

export function retentionForecastRowFromRecord(
  rec: Record<string, unknown>
): RetentionForecastRow {
  const n = (v: unknown) => Number(v) || 0
  return {
    database: String(rec.database ?? ''),
    table: String(rec.table ?? ''),
    ingestBytes: n(rec.ingest_bytes),
    totalIngestBytes: n(rec.total_ingest_bytes),
    windowDays: n(rec.window_days),
    diskBytes: n(rec.disk_bytes),
    olderThan12mBytes: n(rec.older_12m_bytes),
    olderThan24mBytes: n(rec.older_24m_bytes),
    olderThan36mBytes: n(rec.older_36m_bytes),
    // Fail closed: a missing flag must not produce a "no TTL" claim.
    hasTtl: rec.has_ttl === undefined ? true : Number(rec.has_ttl) !== 0,
  }
}

/** The single dominant table without a TTL -> at most one info insight. */
export function insightFromRetentionForecastRows(
  rows: unknown
): InsightCandidate[] {
  if (!Array.isArray(rows)) return []
  let best: { row: RetentionForecastRow; v: RetentionForecastVerdict } | null =
    null
  for (const raw of rows) {
    const row = retentionForecastRowFromRecord(
      (raw ?? {}) as Record<string, unknown>
    )
    const v = classifyRetentionForecast(row)
    if (!v.flagged) continue
    if (!best || row.ingestBytes > best.row.ingestBytes) best = { row, v }
  }
  if (!best) return []

  const { row, v } = best
  const fq = `${row.database}.${row.table}`
  const size = (b: number) => formatReadableSize(b, 2)
  return [
    {
      severity: 'info',
      category: 'storage',
      // Table in the metric, count-free title: the dismissal key survives the
      // numbers changing. The prefix is matched in deriveAction.
      metric: `retention_forecast:${fq}`,
      title: `${fq} dominates ingest and has no TTL`,
      detail:
        `${fq}: ${(v.share * 100).toFixed(0)}% of the ingest on this host ` +
        `(about ${size(v.avgIngestPerDay)} per day over the last ` +
        `${row.windowDays} days), and ${size(row.diskBytes)} on disk with no ` +
        `TTL. Data older than 12 months is ${size(row.olderThan12mBytes)}, ` +
        `older than 24 months ${size(row.olderThan24mBytes)}, older than 36 ` +
        `months ${size(row.olderThan36mBytes)} (active parts whose newest row ` +
        `is that old). This is a forecast from the system.part_log window; ` +
        `part_log retention limits that window, so the daily rate may not ` +
        `represent a full year. Whether and how long to keep this data is a ` +
        `decision for the table owner; nothing is changed.`,
      value: Math.round(v.share * 1000) / 10,
      action: { label: 'View TTL inventory', href: '/ttl-partition-health' },
    },
  ]
}
