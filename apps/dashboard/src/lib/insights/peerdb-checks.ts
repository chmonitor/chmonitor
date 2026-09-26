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
 * and filters work unchanged — never a PeerDB-specific category. Metric names
 * are `peerdb_`-prefixed so they never collide with a ClickHouse/Postgres
 * metric, and titles carry a "PeerDB:" prefix so a finding reads unambiguously
 * wherever it surfaces. Actions deep-link to the existing `/peerdb` pages.
 *
 * ## Identity determinism (load-bearing — read before editing a title)
 *
 * The dismissal key is `peerdb:<id>:<category>:<metric>:<title>`
 * (`insightKey`), so **metric and title may encode only stable identity** — a
 * fleet-wide check's kind, or a per-mirror check's flow name. A run-varying
 * value (a count, a MiB reading, a percentage) in either field re-keys the card
 * on the next sweep and the user's dismissal resurrects it.
 *
 * So the fleet-wide cards use a count-free title (`PeerDB: mirrors are failing`,
 * not `PeerDB: 3 mirrors failed`) and carry the number in `value` / `detail`;
 * the per-mirror cards put the flow slug in the **metric**
 * (`peerdb_mirror_errors:<slug>`) so the collector's `${category}:${metric}`
 * dedup keeps one card per mirror instead of collapsing the fleet into one, and
 * the flow name in the title. This is the same rule `checkPartsPressure`
 * follows — see `docs/knowledge/ai-insights.md`.
 *
 * Slot-lag thresholds come from the shared `lib/peerdb/slot-lag-thresholds`
 * (the same source as the fleet UI's `slotHealth`) so the insights panel and
 * the slot-health table agree on what "lagging" means.
 */

import type { InsightCandidate } from './types'

import { peerDBFlowSlug } from '../peerdb/flow-slug'
import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_TREND_CRITICAL_MB,
  SLOT_LAG_TREND_MIN_POINTS,
  SLOT_LAG_TREND_WARN_MB,
  SLOT_LAG_WARN_MB,
} from '../peerdb/slot-lag-thresholds'

/** Mirror-error log count that escalates from warning to critical. */
export const PEERDB_MIRROR_ERRORS_CRIT = 10

/** Clean, non-empty mirror names, in the order supplied. */
function cleanNames(names: readonly string[]): string[] {
  return names.filter((n) => typeof n === 'string' && n.trim().length > 0)
}

/** `a, b, c` with a `+N more` suffix past three — shared by the fleet cards. */
function nameSummary(list: readonly string[]): string {
  const shown = list.slice(0, 3).join(', ')
  return list.length > 3 ? `${shown}, +${list.length - 3} more` : shown
}

/**
 * Per-mirror metric suffix. The slug (not the raw name) is the identity token,
 * so a name differing only in case/punctuation still resolves to one card, and
 * the metric stays inside the `[a-z0-9_-]` charset the rest of the PeerDB id
 * space uses.
 */
function mirrorMetric(base: string, mirror: string): string {
  return `${base}:${peerDBFlowSlug(mirror)}`
}

/**
 * Failed mirrors — replication is stopped and needs operator action.
 * `names` are the failed mirror names (pre-filtered by the collector).
 */
export function checkFailedMirrors(
  names: readonly string[]
): InsightCandidate | null {
  const list = cleanNames(names)
  if (list.length === 0) return null
  const many = list.length > 1
  return {
    severity: 'critical',
    category: 'reliability',
    metric: 'peerdb_failed_mirrors',
    // Count-free: the number lives in `value`/`detail` so the key is stable.
    title: 'PeerDB: mirrors are failing',
    detail: `${nameSummary(list)} ${many ? 'are' : 'is'} in a failed state — replication for ${many ? 'these mirrors has' : 'this mirror has'} stopped. Check the mirror error logs in /peerdb, fix the cause (schema drift, permissions, destination capacity), then resume from the PeerDB UI.`,
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
  const list = cleanNames(names)
  if (list.length === 0) return null
  const many = list.length > 1
  return {
    severity: 'info',
    category: 'reliability',
    metric: 'peerdb_paused_mirrors',
    // Count-free — see the identity-determinism note above.
    title: 'PeerDB: mirrors are paused',
    detail: `${nameSummary(list)} ${many ? 'are' : 'is'} paused — no data is flowing. Paused mirrors keep their replication slots, so WAL keeps accumulating on the source. Resume or drop ${many ? 'them' : 'it'} if the pause is not intentional.`,
    value: list.length,
    action: { label: 'View mirrors', href: '/peerdb' },
  }
}

/**
 * Terminated mirrors — replication was stopped for good and the flow no longer
 * advances. `normalizeFleetStatus` has always produced this bucket, but nothing
 * alerted on it, so a torn-down pipeline read as a healthy one. `warning`, not
 * `critical`: a termination is often a deliberate teardown, so it is worth
 * surfacing but rarely an incident.
 */
export function checkTerminatedMirrors(
  names: readonly string[]
): InsightCandidate | null {
  const list = cleanNames(names)
  if (list.length === 0) return null
  const many = list.length > 1
  return {
    severity: 'warning',
    category: 'reliability',
    metric: 'peerdb_terminated_mirrors',
    // Count-free — see the identity-determinism note above.
    title: 'PeerDB: mirrors are terminated',
    detail: `${nameSummary(list)} ${many ? 'are' : 'is'} terminated — replication has stopped for good, so ${many ? 'these mirrors no' : 'this mirror no'} longer advance. If the teardown was intentional, delete the flow; otherwise the peer, credentials, or destination for ${many ? 'them' : 'it'} is gone.`,
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
  if (lag < SLOT_LAG_WARN_MB) return null
  const where = label ? ` (${label})` : ''
  return {
    severity: lag >= SLOT_LAG_CRITICAL_MB ? 'critical' : 'warning',
    category: 'performance',
    metric: 'peerdb_slot_lag_mb',
    title: 'PeerDB: replication slot lag is growing',
    detail: `The worst replication slot holds ${Math.round(lag).toLocaleString()} MiB of unreplicated WAL${where}. Sustained slot lag risks source disk pressure and a painful catch-up — check destination write throughput and long-running transactions pinning the slot.`,
    value: Math.round(lag),
    action: { label: 'View peers', href: '/peerdb/peers' },
  }
}

/**
 * Lag *divergence*: a slot whose unreplicated WAL is climbing across the
 * history window, even while it sits below {@link SLOT_LAG_WARN_MB}.
 *
 * `checkSlotLag` reads one instantaneous reading, so a slot at 400 MiB and
 * rising to 900 MiB never trips on a sweep that happens to run early — this is
 * the case it structurally cannot see. The signal is the **delta** between the
 * first and last usable points (MiB), not the level, so it does not re-report
 * what the absolute thresholds already cover; a falling series is recovery, not
 * divergence, and is declined. Non-finite points are dropped rather than
 * treated as zero, so one bad reading cannot fake a collapse in lag.
 */
export function checkSlotLagTrend(
  points: readonly (number | null | undefined)[],
  label: string | null
): InsightCandidate | null {
  const series = (points ?? [])
    .map((p) => (p === null || p === undefined ? Number.NaN : Number(p)))
    .filter((p) => Number.isFinite(p))
  if (series.length < SLOT_LAG_TREND_MIN_POINTS) return null

  const first = series[0]
  const last = series[series.length - 1]
  const growth = last - first
  // Falling (or flat) is recovery, not divergence.
  if (growth < SLOT_LAG_TREND_WARN_MB) return null

  const where = label ? ` (${label})` : ''
  return {
    severity: growth >= SLOT_LAG_TREND_CRITICAL_MB ? 'critical' : 'warning',
    category: 'performance',
    metric: 'peerdb_slot_lag_trend',
    // Count-free / value-free in the title — only the delta rides in value.
    title: 'PeerDB: replication slot lag is diverging',
    detail: `Unreplicated WAL on the worst slot grew ${Math.round(growth).toLocaleString()} MiB across the last ${series.length} readings (${Math.round(first).toLocaleString()} → ${Math.round(last).toLocaleString()} MiB)${where}. The slot is falling behind faster than the destination drains it — raise the threshold only if this is expected; otherwise check destination write throughput and long-running transactions on the source.`,
    value: Math.round(growth),
    action: { label: 'View peers', href: '/peerdb/peers' },
  }
}

/**
 * Error-log volume for one mirror. A mirror emitting repeated errors is
 * usually about to fail (or already intermittently failing batches).
 *
 * Per-mirror: the flow slug rides in the metric so each noisy mirror gets its
 * own card and its own stable dismissal.
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
    metric: mirrorMetric('peerdb_mirror_errors', mirror),
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
 *
 * Per-mirror, so the metric carries the flow slug (see `checkMirrorErrors`).
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
    metric: mirrorMetric('peerdb_snapshot_stalled', mirror),
    title: `PeerDB: ${mirror} snapshot is stalled`,
    detail: `${mirror} is still in snapshot/initial-load with ${tablesDone} of ${tablesTotal} tables fully cloned — CDC catch-up cannot start until the snapshot completes. Check QRep partition errors and destination capacity.`,
    value: tablesTotal - tablesDone,
    action: { label: 'View mirrors', href: '/peerdb' },
  }
}
