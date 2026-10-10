/**
 * Pure status computation for the /health page.
 *
 * Extracted from the individual card components so the grid can compute every
 * card's status up-front — which it needs in order to sort by severity, count
 * issues for the summary banner, and drive the filter tabs. The cards then
 * become presentational, rendering the result rather than recomputing it.
 *
 * Everything here is pure (no React, no side effects), so it is unit-testable
 * and shared by both the grid and the cards.
 */

import type { HealthCheckDef } from '@/components/health/health-checks'
import type { HealthCheckState } from '@/components/health/use-health-checks'
import type { Thresholds } from '@/lib/health/thresholds-storage'
import type { PeerDBFleetMetrics } from '@/lib/peerdb/fleet-metrics'

import { classifyValue } from '@/lib/alerting/rule-registry'
import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_WARN_MB,
} from '@/lib/peerdb/slot-lag-thresholds'

export type HealthStatus = 'ok' | 'warning' | 'critical' | 'loading' | 'error'

/** Sort order: worst first, then unknown (error/loading) last. */
export const SEVERITY_RANK: Record<HealthStatus, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
  error: 3,
  loading: 4,
}

/** Severities that count toward the aggregate banner / filter tallies. */
export type CountableSeverity = 'critical' | 'warning' | 'ok'

export interface ComputedCheck {
  status: HealthStatus
  /** Numeric value, or null when loading / error / non-finite. */
  value: number | null
  /** Human-readable sub-label (e.g. "106 failed queries in last hour"). */
  label: string
  /** Formatted headline value (e.g. "106", "84.9%", "—"). */
  displayValue: string
  /** First data row, forwarded to the detail dialog. */
  row?: Record<string, unknown>
}

/**
 * Resolve a standard health check into a renderable state.
 *
 * Mirrors the threshold logic that previously lived inline in `HealthCard`:
 * `value >= critical` → critical, `value >= warning` → warning, else ok.
 */
export function computeCheckStatus(
  check: HealthCheckDef,
  thresholds: Thresholds,
  result: HealthCheckState,
  isLoading: boolean
): ComputedCheck {
  let status: HealthStatus = 'loading'
  let value: number | null = null
  let label = ''
  let row: Record<string, unknown> | undefined

  const metaStatus = result.status
  const isUnavailable =
    metaStatus === 'table_not_found' || metaStatus === 'table_not_configured'

  if (isLoading) {
    status = 'loading'
    label = 'Loading…'
  } else if (result.error) {
    status = 'error'
    label = 'Unavailable'
  } else if (isUnavailable) {
    status = 'error'
    label = result.statusMessage ?? 'Unavailable'
  } else if (result.data && result.data.length > 0) {
    row = result.data[0] as Record<string, unknown>
    const raw = row[check.valueKey]
    value = raw === null || raw === undefined ? 0 : Number(raw)
    label = check.formatLabel ? check.formatLabel(value) : String(value)
    if (Number.isFinite(value)) {
      status = classifyValue(value, thresholds)
    } else {
      status = 'error'
      label = 'Invalid value'
      value = null
    }
  } else {
    value = 0
    label = check.formatLabel ? check.formatLabel(0) : '0'
    status = 'ok'
  }

  const displayValue = check.formatValue
    ? check.formatValue(value)
    : value !== null
      ? value.toLocaleString()
      : '—'

  return { status, value, label, displayValue, row }
}

export interface ComputedMutations {
  status: HealthStatus
  /** Headline value the card shows and tracks for the sparkline. */
  value: number
  label: string
}

/**
 * Stuck/active/failed mutations. Any stuck or failed mutation is critical;
 * more than five active is a warning. The headline value is the stuck count.
 */
export function computeStuckMutations(
  result: HealthCheckState,
  isLoading: boolean
): ComputedMutations {
  let status: HealthStatus = 'loading'
  let stuck = 0
  let active = 0
  let failed = 0
  let label = ''

  if (isLoading) {
    status = 'loading'
    label = 'Loading…'
  } else if (result.error) {
    status = 'error'
    label = 'Unavailable'
  } else if (result.data && result.data.length > 0) {
    const row = result.data[0] as Record<string, unknown>
    stuck = Number(row.stuck ?? 0)
    active = Number(row.active ?? 0)
    failed = Number(row.failed ?? 0)
    if (
      !Number.isFinite(stuck) ||
      !Number.isFinite(active) ||
      !Number.isFinite(failed)
    ) {
      status = 'error'
      label = 'Invalid value'
      stuck = 0
      active = 0
      failed = 0
    } else {
      label = `${active} active · ${stuck} stuck · ${failed} failed`
      // Mutations-specific rules layered on the shared classifier: any stuck or
      // failed mutation (count ≥ 1) is critical; more than five active is a
      // warning. Counts are non-negative integers, so `> 0` ≡ `>= 1` and
      // `> 5` ≡ `>= 6`. Take the worst of the two signals.
      const blockingStatus = classifyValue(Math.max(stuck, failed), {
        warning: Number.POSITIVE_INFINITY,
        critical: 1,
      })
      const activeStatus = classifyValue(active, {
        warning: 6,
        critical: Number.POSITIVE_INFINITY,
      })
      status =
        SEVERITY_RANK[blockingStatus] <= SEVERITY_RANK[activeStatus]
          ? blockingStatus
          : activeStatus
    }
  } else {
    status = 'ok'
    label = '0 active · 0 stuck · 0 failed'
  }

  return { status, value: stuck, label }
}

/**
 * Running mutations. 10+ is critical, 3+ is a warning. The headline value is
 * the running count.
 */
export function computeRunningMutations(
  result: HealthCheckState,
  isLoading: boolean
): ComputedMutations {
  let status: HealthStatus = 'loading'
  let value = 0
  let label = ''

  if (isLoading) {
    status = 'loading'
    label = 'Loading…'
  } else if (result.error) {
    status = 'error'
    label = 'Unavailable'
  } else if (result.data && result.data.length > 0) {
    const row = result.data[0] as Record<string, unknown>
    value = Number(row.running_count ?? 0)
    if (!Number.isFinite(value)) {
      status = 'error'
      label = 'Invalid value'
      value = 0
    } else {
      label = `${value.toLocaleString()} running mutations`
      status = classifyValue(value, { warning: 3, critical: 10 })
    }
  } else {
    label = '0 running mutations'
    status = 'ok'
  }

  return { status, value, label }
}

/** How the PeerDB health items reach the grid (see `health-grid.tsx`). */
export type PeerDBHealthSource =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; metrics: PeerDBFleetMetrics }

/**
 * PeerDB fleet health, computed from the already-fetched
 * `GET /api/v1/peerdb-metrics` summary rather than from a chart-registry query.
 *
 * This is the **bespoke-item** pattern, the same one `computeStuckMutations`
 * uses: the `/health` pipeline resolves every standard check through the
 * ClickHouse chart registry and executes `queryDef.sql` against a ClickHouse
 * host, which a PeerDB gRPC-gateway REST source cannot satisfy. Forcing PeerDB
 * through it would break the layering boundary depcruise enforces.
 *
 * The slot-lag thresholds are the shared `lib/peerdb/slot-lag-thresholds`, so
 * the Health card and the `/peerdb` slot-health table agree on what "lagging"
 * means. Every field is defensive — a partial PeerDB payload (some sub-fetch
 * failed) must never read as a healthy fleet, so a missing number is `0` only
 * when the collection genuinely is empty.
 */
export function computePeerDBHealth(
  source: PeerDBHealthSource
): ComputedMutations {
  if (source.kind === 'loading') {
    return { status: 'loading', value: 0, label: 'Loading…' }
  }
  if (source.kind === 'error') {
    return { status: 'error', value: 0, label: 'Unavailable' }
  }

  const m = source.metrics
  const failed = m.failedMirrors.length
  const paused = m.pausedMirrors.length
  const terminated = m.terminatedMirrors.length
  const lag = m.maxSlotLagMb

  const label =
    `${m.totalMirrors} mirrors · ` +
    `${failed} failed · ${paused} paused · ${terminated} terminated · ` +
    `worst slot lag ${lag === null ? '—' : `${Math.round(lag).toLocaleString()} MiB`}`

  if (m.totalMirrors === 0) {
    return { status: 'ok', value: 0, label: 'No PeerDB mirrors' }
  }

  // Take the worst of the three independent conditions; each is "higher is
  // worse" and non-negative, so classifyValue is the right tool for all three.
  const worst = (v: number, warning: number, critical: number) =>
    classifyValue(v, { warning, critical })
  const failedStatus = worst(failed, 1, 3)
  const terminatedStatus = worst(terminated, 1, 5)
  const lagStatus =
    lag === null
      ? ('ok' as HealthStatus)
      : classifyValue(lag, {
          warning: SLOT_LAG_WARN_MB,
          critical: SLOT_LAG_CRITICAL_MB,
        })

  const status = [
    failedStatus,
    terminatedStatus,
    lagStatus,
  ].reduce<HealthStatus>(
    (worstSoFar, s) =>
      SEVERITY_RANK[s] < SEVERITY_RANK[worstSoFar] ? s : worstSoFar,
    'ok'
  )

  // The headline value is the count an operator acts on first.
  return { status, value: failed + terminated, label }
}

/** The PeerDB Health cards, one per check (`components/health/peerdb-cards.tsx`). */
export type PeerDBCheckId =
  | 'peerdb-fleet'
  | 'peerdb-api'
  | 'peerdb-mirror-failures'
  | 'peerdb-paused'
  | 'peerdb-slot-lag'

/** One PeerDB card's result, plus the mirrors it is about (worst first). */
export interface PeerDBCheckResult extends ComputedMutations {
  mirrors: string[]
}

/**
 * Why `GET /api/v1/peerdb-metrics` failed, from the client-side error message.
 *
 * The route answers 401/403 when PeerDB rejects the credentials and 502 when it
 * cannot be reached or timed out; `usePeerDBMetrics` keeps that status in its
 * message as `(NNN)`. Anything without a 401/403 reads as unreachable.
 */
export function classifyPeerDBApiError(
  message: string
): 'auth' | 'unreachable' {
  return /\b(401|403)\b/.test(message) ? 'auth' : 'unreachable'
}

const worseOf = (a: HealthStatus, b: HealthStatus): HealthStatus =>
  SEVERITY_RANK[b] < SEVERITY_RANK[a] ? b : a

const nameList = (names: readonly string[]) =>
  names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`

/**
 * Per-card PeerDB status, so each card sorts and alerts on its own condition
 * instead of every card sharing the fleet's worst status.
 *
 * Only checks whose data already reaches the browser are here. Paused age,
 * snapshot-stalled duration, zero throughput and last-sync age need per-mirror
 * timestamps that `/api/v1/peerdb-metrics` does not return yet, so they have no
 * card rather than a guessed one.
 */
export function computePeerDBCheck(
  id: PeerDBCheckId,
  source: PeerDBHealthSource
): PeerDBCheckResult {
  if (source.kind === 'loading') {
    return { status: 'loading', value: 0, label: 'Loading…', mirrors: [] }
  }

  if (id === 'peerdb-api') {
    if (source.kind === 'error') {
      const auth = classifyPeerDBApiError(source.message) === 'auth'
      return {
        status: 'critical',
        value: 1,
        label: auth
          ? 'PeerDB rejected the credentials — check the PeerDB API username and password'
          : 'PeerDB API unreachable — check PEERDB_API_URL and the network path',
        mirrors: [],
      }
    }
    return {
      status: 'ok',
      value: 0,
      label: 'PeerDB API reachable',
      mirrors: [],
    }
  }

  if (source.kind === 'error') {
    return { status: 'error', value: 0, label: 'Unavailable', mirrors: [] }
  }

  const m = source.metrics
  switch (id) {
    case 'peerdb-fleet':
      return {
        ...computePeerDBHealth(source),
        mirrors: [
          ...m.failedMirrors,
          ...m.terminatedMirrors,
          ...m.pausedMirrors,
        ],
      }
    case 'peerdb-mirror-failures': {
      const failed = m.failedMirrors.length
      const terminated = m.terminatedMirrors.length
      const status = worseOf(
        classifyValue(failed, { warning: 1, critical: 3 }),
        classifyValue(terminated, { warning: 1, critical: 5 })
      )
      const mirrors = [...m.failedMirrors, ...m.terminatedMirrors]
      const label =
        mirrors.length === 0
          ? 'No failed or terminated mirrors'
          : `${failed} failed · ${terminated} terminated: ${nameList(mirrors)}`
      return { status, value: mirrors.length, label, mirrors }
    }
    case 'peerdb-paused': {
      const paused = m.pausedMirrors.length
      // Warning only: without a paused-since timestamp a deliberate pause and a
      // forgotten one look the same, so this never escalates to critical.
      const status: HealthStatus = paused > 0 ? 'warning' : 'ok'
      const label =
        paused === 0
          ? 'No paused mirrors'
          : `${paused} paused: ${nameList(m.pausedMirrors)}`
      return { status, value: paused, label, mirrors: [...m.pausedMirrors] }
    }
    case 'peerdb-slot-lag': {
      const lag = m.maxSlotLagMb
      if (lag === null) {
        return {
          status: 'ok',
          value: 0,
          label: 'No replication-slot lag reported',
          mirrors: [],
        }
      }
      const status = classifyValue(lag, {
        warning: SLOT_LAG_WARN_MB,
        critical: SLOT_LAG_CRITICAL_MB,
      })
      // `maxSlotLagLabel` is `peer/slot`; the peer is the mirror to open.
      const peer = m.maxSlotLagLabel?.split('/')[0] ?? ''
      const mbText = `${Math.round(lag).toLocaleString()} MiB`
      return {
        status,
        value: Math.round(lag),
        label: m.maxSlotLagLabel
          ? `Worst slot ${m.maxSlotLagLabel}: ${mbText}`
          : `Worst slot lag ${mbText}`,
        mirrors: peer ? [peer] : [],
      }
    }
  }
}
