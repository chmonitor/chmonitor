/**
 * Unread tables and unused projections: pure classifier + row-to-insight mapping.
 *
 * No I/O. The SQL lives in `usage-findings-sql.ts`, the collector in
 * `usage-collector.ts`.
 *
 * Background (#4067, slice 4): a large table that no finished SELECT in the
 * query log read is worth a question to its owner. It is evidence of "unread
 * in this replica's log window", never proof of "unused", so the cards state
 * the window and the replica scope, never emit DDL and never say "safe to drop".
 */

import type { InsightCandidate } from './types'

import { formatReadableSize } from '../format-readable'

const GIB = 1024 ** 3

/** Smallest table or projection worth a card. */
export const USAGE_MIN_BYTES = 10 * GIB
/** A log that covers fewer days proves nothing about what is read. */
export const USAGE_MIN_WINDOW_DAYS = 7

export interface UsageRow {
  database: string
  table: string
  /** Projection name; empty for a table row. */
  name: string
  bytes: number
  /** `min(event_date)` of the log window; empty when the log is empty. */
  windowStart: string
  /** Whole days from `windowStart` to today; 0 when the log is empty. */
  windowDays: number
}

export function usageRowFromRecord(rec: Record<string, unknown>): UsageRow {
  const n = (v: unknown) => Number(v) || 0
  return {
    database: String(rec.database ?? ''),
    table: String(rec.table ?? ''),
    name: String(rec.name ?? ''),
    bytes: n(rec.bytes),
    windowStart:
      rec.log_window_start == null ? '' : String(rec.log_window_start),
    windowDays: n(rec.log_window_days),
  }
}

/** True when the row clears the size floor and the log covers enough days. */
export function isUsageFinding(row: UsageRow): boolean {
  return (
    row.bytes >= USAGE_MIN_BYTES &&
    row.windowDays >= USAGE_MIN_WINDOW_DAYS &&
    row.windowStart !== '' &&
    row.database !== '' &&
    row.table !== ''
  )
}

function largest(rows: unknown, wantName: boolean): UsageRow | null {
  if (!Array.isArray(rows)) return null
  let best: UsageRow | null = null
  for (const raw of rows) {
    const row = usageRowFromRecord((raw ?? {}) as Record<string, unknown>)
    if (!isUsageFinding(row)) continue
    if (wantName !== (row.name !== '')) continue
    if (!best || row.bytes > best.bytes) best = row
  }
  return best
}

const SCOPE =
  `Only this replica's system.query_log was checked: other replicas and ` +
  `shards keep their own log, so they may still read it. Unread is not the ` +
  `same as unused: a job that runs less often than the log retains, or a ` +
  `read the log does not attribute here, is not visible. Nothing is changed.`

/** The single largest unread table -> at most one info insight. */
export function insightFromUnreadTableRows(rows: unknown): InsightCandidate[] {
  const row = largest(rows, false)
  if (!row) return []
  const fq = `${row.database}.${row.table}`
  return [
    {
      severity: 'info',
      category: 'storage',
      // Table in the metric, count-free title: the dismissal key survives the
      // numbers changing. The prefix is matched in deriveAction.
      metric: `usage:unread_table:${fq}`,
      title: `${fq} was not read in the query log window`,
      detail:
        `${fq} (${formatReadableSize(row.bytes, 2)} on disk) was not read by ` +
        `any finished SELECT since ${row.windowStart}, the start of this ` +
        `replica's query log window (${row.windowDays} days). ${SCOPE}`,
      value: row.bytes,
      action: { label: 'View unread tables', href: '/unused-tables' },
    },
  ]
}

/** The single largest unused projection -> at most one info insight. */
export function insightFromUnusedProjectionRows(
  rows: unknown
): InsightCandidate[] {
  const row = largest(rows, true)
  if (!row) return []
  const fq = `${row.database}.${row.table}.${row.name}`
  return [
    {
      severity: 'info',
      category: 'storage',
      metric: `usage:unused_projection:${fq}`,
      title: `Projection ${fq} was not used in the query log window`,
      detail:
        `Projection ${fq} (${formatReadableSize(row.bytes, 2)} on disk) was ` +
        `not used by any finished SELECT since ${row.windowStart}, the start ` +
        `of this replica's query log window (${row.windowDays} days). ${SCOPE}`,
      value: row.bytes,
      action: { label: 'View unused projections', href: '/unused-projections' },
    },
  ]
}
