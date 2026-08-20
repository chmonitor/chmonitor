import type { QRepPartition } from '@/lib/peerdb/types'

import { durationMs, toNumber } from './peerdb-utils'

export function partitionState(
  p: QRepPartition
): 'done' | 'running' | 'queued' | 'error' {
  if (p.endTime) {
    const synced = toNumber(p.rowsSynced)
    const total = toNumber(p.rowsInPartition ?? p.numRows)
    // If endTime is set but rowsSynced < rowsInPartition, the partition failed.
    if (total > 0 && synced > 0 && synced < total) return 'error'
    return 'done'
  }
  // A partition that has started (has a startTime) or already synced rows is
  // in flight; only un-started partitions are queued.
  if (p.startTime || toNumber(p.rowsSynced) > 0) return 'running'
  return 'queued'
}

export interface JobPartitionAnalytics {
  total: number
  done: number
  running: number
  queued: number
  error: number
  rowsIn: number
  rowsSynced: number
  /** Mean duration of finished partitions, seconds. Null when none have ended. */
  avgDurationSec: number | null
}

/**
 * Aggregate QRep / initial-load partition stats for the job header. Pure so
 * the list, expanded row, and detail page share one definition of "done".
 */
export function jobPartitionAnalytics(
  partitions: QRepPartition[]
): JobPartitionAnalytics {
  let done = 0
  let running = 0
  let queued = 0
  let error = 0
  let rowsIn = 0
  let rowsSynced = 0
  let durationSum = 0
  let durationN = 0

  for (const p of partitions) {
    const state = partitionState(p)
    if (state === 'done') done++
    else if (state === 'running') running++
    else if (state === 'error') error++
    else queued++
    rowsIn += toNumber(p.rowsInPartition ?? p.numRows)
    rowsSynced += toNumber(p.rowsSynced)
    const dur = durationMs(p.startTime, p.endTime ?? p.pullEndTime)
    if (dur != null && state === 'done') {
      durationSum += dur
      durationN++
    }
  }

  return {
    total: partitions.length,
    done,
    running,
    queued,
    error,
    rowsIn,
    rowsSynced,
    avgDurationSec: durationN > 0 ? durationSum / durationN / 1000 : null,
  }
}
