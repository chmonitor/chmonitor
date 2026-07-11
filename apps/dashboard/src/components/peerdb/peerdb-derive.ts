import type { CDCBatch, CloneTableSummary, SlotInfo } from '@/lib/peerdb/types'

import { parseTs, toNumber } from './peerdb-utils'

/**
 * Wall-clock duration of a CDC batch in seconds, from start→end timestamps.
 * Returns null when either endpoint is missing or unparseable so callers can
 * render an em-dash rather than a bogus 0. Negative spans (clock skew) clamp
 * to 0.
 */
export function batchDurationSec(batch: CDCBatch): number | null {
  const start = parseTs(batch.startTime)
  const end = parseTs(batch.endTime)
  if (start == null || end == null) return null
  return Math.max(0, (end - start) / 1000)
}

export interface CloneProgress {
  completed: number
  total: number
  /** Percent of partitions completed, 0–100 (0 when total is unknown). */
  pct: number
  /** True once both fetch and consolidate phases report complete. */
  done: boolean
}

/**
 * Snapshot / initial-load progress for one cloned table. Percent is driven by
 * partitions completed vs total; a table with fetch+consolidate both complete
 * is treated as 100% done even if the partition counters lag.
 */
export function cloneProgress(summary: CloneTableSummary): CloneProgress {
  const completed = toNumber(summary.numPartitionsCompleted)
  const total = toNumber(summary.numPartitionsTotal)
  const done = Boolean(summary.fetchCompleted && summary.consolidateCompleted)
  let pct = total > 0 ? (completed / total) * 100 : 0
  if (done) pct = 100
  return {
    completed,
    total,
    pct: Math.min(100, Math.max(0, pct)),
    done,
  }
}

export type SlotHealth = 'ok' | 'warn' | 'critical'

/** Lag thresholds (MiB) for replication-slot health classification. */
export const SLOT_LAG_WARN_MB = 512
export const SLOT_LAG_CRITICAL_MB = 2048

/**
 * Classify a replication slot's health from its lag and WAL status.
 *
 * - `critical` — lag past the critical threshold, an inactive slot still
 *   retaining WAL, or a non-`reserved`/`extended` WAL status ("unreserved" or
 *   "lost" mean Postgres may drop or has dropped required WAL).
 * - `warn` — lag past the warning threshold.
 * - `ok` — otherwise.
 */
export function slotHealth(slot: SlotInfo): SlotHealth {
  const lag = toNumber(slot.lagInMb)
  const wal = (slot.walStatus ?? '').toLowerCase()
  const active = slot.active !== false

  if (wal === 'unreserved' || wal === 'lost') return 'critical'
  if (lag >= SLOT_LAG_CRITICAL_MB) return 'critical'
  // An inactive slot that is still holding meaningful WAL is a leak risk.
  if (!active && lag >= SLOT_LAG_WARN_MB) return 'critical'
  if (lag >= SLOT_LAG_WARN_MB) return 'warn'
  return 'ok'
}
