/**
 * Pure classifiers for the PeerDB insight collectors.
 *
 * The PeerDB analog of `operational-checks.ts` / `postgres-checks.ts`: each
 * function maps an already-extracted fleet reading to an `InsightCandidate` or
 * `null` when it is not worth surfacing. Deliberately pure (no PeerDB / store
 * I/O) so thresholds are unit-tested without a live deployment.
 *
 * Category reuse: findings reuse the existing insight categories
 * (`reliability` / `performance` / `storage`) so the board's `CATEGORY_META`
 * and filters work unchanged. Metric names are `peerdb_`-prefixed so they never
 * collide with a ClickHouse/Postgres metric, and titles carry a "PeerDB:"
 * prefix so a finding reads unambiguously wherever it surfaces. Actions
 * deep-link to the existing `/peerdb` pages.
 *
 * Slot-lag thresholds intentionally reuse the fleet UI's `SLOT_LAG_WARN_MB` /
 * `SLOT_LAG_CRITICAL_MB` (see `components/peerdb/peerdb-derive`) so the
 * insights panel and the slot-health table agree on what "lagging" means.
 */

import type { InsightCandidate } from './types'

/** Reuse the fleet UI's slot-lag thresholds (single source of truth lives here). */
export const PEERDB_SLOT_LAG_WARN_MB = 512
export const PEERDB_SLOT_LAG_CRITICAL_MB = 2048

/** Mirror-error log count that escalates from warning to critical. */
export const PEERDB_MIRROR_ERRORS_CRIT = 10

/**
 * Failed mirrors — replication is stopped and needs operator action.
 * `names` are the failed mirror names (pre-filtered by the collector).
 */
export function checkFailedMirrors(
  names: readonly string[]
): InsightCandidate | null {
  const list = names.filter((n) => typeof n === 'string' && n.trim().length > 0)
  if (list.length === 0) return null
  const shown = list.slice(0, 3).join(', ')
  const more = list.length > 3 ? `, +${list.length - 3} more` : ''
  return {
    severity: 'critical',
    category: 'reliability',
    metric: 'peerdb_failed_mirrors',
    title: `PeerDB: ${list.length} mirror${list.length > 1 ? 's' : ''} failed`,
    detail: `${shown}${more} ${list.length > 1 ? 'are' : 'is'} in a failed state — replication for ${list.length > 1 ? 'these mirrors has' : 'this mirror has'} stopped. Check the mirror error logs in /peerdb, fix the cause (schema drift, permissions, destination capacity), then resume from the PeerDB UI.`,
    value: list.length,
    action: { label: 'View mirrors', href: '/peerdb' },
  }
}

/**
 * Paused/pausing mirrors — replication is intentionally or unexpectedly held.
 * Informational: paused mirrors retain replication slots that keep holding WAL.
 */
export function checkPausedMirrors(
  names: readonly string[]
): InsightCandidate | null {
  const list = names.filter((n) => typeof n === 'string' && n.trim().length > 0)
  if (list.length === 0) return null
  const shown = list.slice(0, 3).join(', ')
  const more = list.length > 3 ? `, +${list.length - 3} more` : ''
  return {
    severity: 'info',
    category: 'reliability',
    metric: 'peerdb_paused_mirrors',
    title: `PeerDB: ${list.length} mirror${list.length > 1 ? 's' : ''} paused`,
    detail: `${shown}${more} ${list.length > 1 ? 'are' : 'is'} paused — no data is flowing. Paused mirrors keep their replication slots, so WAL keeps accumulating on the source. Resume or drop ${list.length > 1 ? 'them' : 'it'} if the pause is not intentional.`,
    value: list.length,
    action: { label: 'View mirrors', href: '/peerdb' },
  }
}

/**
 * Worst fleet-wide replication-slot lag, in MiB. Reuses the fleet UI's warn /
 * critical thresholds so the panel agrees with the slot-health table.
 */
export function checkSlotLag(
  maxLagMb: number | null,
  label: string | null
): InsightCandidate | null {
  if (!Number.isFinite(maxLagMb as number)) return null
  const lag = maxLagMb as number
  if (lag < PEERDB_SLOT_LAG_WARN_MB) return null
  const where = label ? ` (${label})` : ''
  return {
    severity: lag >= PEERDB_SLOT_LAG_CRITICAL_MB ? 'critical' : 'warning',
    category: 'performance',
    metric: 'peerdb_slot_lag_mb',
    title: 'PeerDB: replication slot lag is growing',
    detail: `The worst replication slot holds ${Math.round(lag).toLocaleString()} MiB of unreplicated WAL${where}. Sustained slot lag risks source disk pressure and a painful catch-up — check destination write throughput and long-running transactions pinning the slot.`,
    value: Math.round(lag),
    action: { label: 'View peers', href: '/peerdb/peers' },
  }
}

/**
 * Error-log volume for one mirror. A mirror emitting repeated errors is
 * usually about to fail (or already intermittently failing batches).
 */
export function checkMirrorErrors(
  mirror: string,
  errorCount: number
): InsightCandidate | null {
  if (!mirror || !Number.isFinite(errorCount) || errorCount <= 0) return null
  if (errorCount < 3) return null
  return {
    severity: errorCount >= PEERDB_MIRROR_ERRORS_CRIT ? 'critical' : 'warning',
    category: 'reliability',
    metric: 'peerdb_mirror_errors',
    title: `PeerDB: ${mirror} is emitting errors`,
    detail: `${mirror} logged ${errorCount} errors recently. Repeated mirror errors usually precede a failed state — inspect the mirror log feed in /peerdb and fix the underlying cause before replication stalls.`,
    value: errorCount,
    action: { label: 'View mirror logs', href: '/peerdb' },
  }
}

/**
 * Snapshot / initial-load stall: a mirror stuck in snapshot phase with no
 * clone progress. `tablesTotal` is the clone table count, `tablesDone` how many
 * report fetch+consolidate complete.
 */
export function checkSnapshotStalled(
  mirror: string,
  tablesTotal: number,
  tablesDone: number
): InsightCandidate | null {
  if (!mirror) return null
  if (
    !Number.isFinite(tablesTotal) ||
    !Number.isFinite(tablesDone) ||
    tablesTotal <= 0 ||
    tablesDone >= tablesTotal
  )
    return null
  return {
    severity: 'warning',
    category: 'performance',
    metric: 'peerdb_snapshot_stalled',
    title: `PeerDB: ${mirror} snapshot is stalled`,
    detail: `${mirror} is still in snapshot/initial-load with ${tablesDone} of ${tablesTotal} tables fully cloned — CDC catch-up cannot start until the snapshot completes. Check QRep partition errors and destination capacity.`,
    value: tablesTotal - tablesDone,
    action: { label: 'View mirrors', href: '/peerdb' },
  }
}
