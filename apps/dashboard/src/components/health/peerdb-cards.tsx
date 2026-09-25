'use client'

/**
 * PeerDB items on the Health Summary page (#3439).
 *
 * ## Why this is a bespoke item, not a `HEALTH_CHECKS` entry
 *
 * Every standard check resolves through the ClickHouse chart registry: the grid
 * collects `HEALTH_CHECKS[].chartName` into one batch and
 * `/api/v1/health/checks` executes `queryDef.sql` against a ClickHouse host. PeerDB
 * is a gRPC-gateway REST source with no SQL at all, so a `health-*` chart entry
 * would have to fake a query to reach it — breaking the layering boundary
 * depcruise enforces, and lying in the dialog's "SQL query" panel.
 *
 * Instead this follows the pattern `mutations-cards.tsx` already established: a
 * local `HealthCheckDef`-shaped def (so the card reuses the shared shell, the
 * detail dialog, and the configure-alert affordance for free) plus a `computeX`
 * in `lib/health/health-status.ts`. Data comes from `usePeerDBMetrics` — the
 * same hook the `/peerdb` page uses, already cached for 30s server-side.
 *
 * ## Gating
 *
 * The items are **absent**, not empty, when `PEERDB_API_URL` is unset:
 * `usePeerDBMetrics` resolves a `configured: false` payload rather than an
 * error, and `HealthGrid` drops the whole group in that case. A green "0 failed"
 * card for a product the deployment does not run would be a lie.
 *
 * `chartName` is deliberately empty: it is never resolved through the chart
 * registry (see above) and exists only so the shared shell and detail dialog get
 * the `HealthCheckDef` shape they expect.
 */

import { Database, Timer, XCircle } from 'lucide-react'

import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type { PeerDBHealthSource } from '@/lib/health/health-status'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCheckDef } from './health-checks'
import type { AlertRuleStoreAvailability } from './use-alert-signals'

import { AlertConfiguredBadge } from './alert-configured-badge'
import { HealthCardShell } from './health-card-shell'
import { HealthDetailDialog } from './health-detail-dialog'
import { NO_ALERT_SIGNALS } from './use-alert-signals'
import { useState } from 'react'
import { computePeerDBHealth } from '@/lib/health/health-status'
import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_WARN_MB,
} from '@/lib/peerdb/slot-lag-thresholds'

const PEERDB_LINKS = [
  { label: 'PeerDB Mirrors', href: '/peerdb' },
  { label: 'PeerDB Peers', href: '/peerdb/peers' },
] as const

const PEERDB_FLEET_DEF: HealthCheckDef = {
  id: 'peerdb-fleet',
  title: 'PeerDB Fleet',
  icon: Database,
  chartName: '',
  valueKey: 'value',
  defaults: { warning: 1, critical: 3 },
  description:
    'PeerDB replication fleet health: failed, paused and terminated mirrors plus the worst replication-slot lag. Sourced from GET /api/v1/peerdb-metrics, not from a ClickHouse query.',
  relatedLinks: PEERDB_LINKS,
  docsLinks: [{ label: 'PeerDB', url: 'https://docs.peerdb.io/' }],
}

const PEERDB_SLOT_LAG_DEF: HealthCheckDef = {
  ...PEERDB_FLEET_DEF,
  id: 'peerdb-slot-lag',
  title: 'PeerDB Slot Lag',
  icon: Timer,
  defaults: { warning: SLOT_LAG_WARN_MB, critical: SLOT_LAG_CRITICAL_MB },
  description: `Worst unreplicated WAL held by any PeerDB replication slot, in MiB. Warn at ${SLOT_LAG_WARN_MB.toLocaleString()} MiB, critical at ${SLOT_LAG_CRITICAL_MB.toLocaleString()} MiB — the same thresholds the PeerDB slot-health table uses.`,
  relatedLinks: [{ label: 'PeerDB Peers', href: '/peerdb/peers' }],
}

const PEERDB_MIRROR_FAILURES_DEF: HealthCheckDef = {
  ...PEERDB_FLEET_DEF,
  id: 'peerdb-mirror-failures',
  title: 'PeerDB Mirror Failures',
  icon: XCircle,
  description:
    'Failed and terminated PeerDB mirrors. A failed mirror has stopped replicating; a terminated one will not start again — the teardown was either deliberate or the peer, credentials, or destination is gone.',
  relatedLinks: [{ label: 'PeerDB Mirrors', href: '/peerdb' }],
}

const mb = (n: number) => `${Math.round(n).toLocaleString()} MiB`

/** The three PeerDB items, in display order. */
export const PEERDB_HEALTH_DEFS: readonly HealthCheckDef[] = [
  PEERDB_FLEET_DEF,
  PEERDB_SLOT_LAG_DEF,
  PEERDB_MIRROR_FAILURES_DEF,
]

export const PEERDB_HEALTH_IDS: readonly string[] = PEERDB_HEALTH_DEFS.map(
  (d) => d.id
)

/**
 * The one number this item is about — the card's headline, and the value the
 * grid appends to the shared sparkline history.
 *
 * Each card shows the number an operator would act on first, while
 * {@link computePeerDBHealth} supplies the shared status from all three
 * conditions — so the fleet card can be green while the lag card is red.
 * `null` while loading/unavailable, which leaves the history untouched.
 */
export function peerDBHeadlineValue(
  defId: string,
  source: PeerDBHealthSource
): number | null {
  if (source.kind !== 'data') return null
  const m = source.metrics
  switch (defId) {
    case 'peerdb-slot-lag':
      return m.maxSlotLagMb === null ? null : Math.round(m.maxSlotLagMb)
    case 'peerdb-mirror-failures':
      return m.failedMirrors.length + m.terminatedMirrors.length
    default:
      return m.totalMirrors
  }
}

function displayValueFor(defId: string, source: PeerDBHealthSource): string {
  const value = peerDBHeadlineValue(defId, source)
  if (value === null) return '—'
  return defId === 'peerdb-slot-lag' ? mb(value) : value.toLocaleString()
}

export function PeerDBHealthCard({
  def,
  hostId,
  source,
  spark,
  variant,
  signals = NO_ALERT_SIGNALS,
  availability = 'unknown',
}: {
  def: HealthCheckDef
  hostId: number
  source: PeerDBHealthSource
  spark?: number[]
  variant?: HealthCardVariant
  signals?: MetricAlertSignals
  availability?: AlertRuleStoreAvailability
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const computed = computePeerDBHealth(source)

  return (
    <>
      <HealthCardShell
        icon={def.icon}
        title={def.title}
        status={computed.status}
        displayValue={displayValueFor(def.id, source)}
        sublabel={computed.label}
        spark={spark}
        links={def.relatedLinks}
        hostId={hostId}
        onExpand={() => setDetailOpen(true)}
        variant={variant}
        badge={<AlertConfiguredBadge signals={signals} />}
      />

      <HealthDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        check={def}
        hostId={hostId}
        status={computed.status}
        value={computed.value}
        label={computed.label}
        thresholds={def.defaults}
        signals={signals}
        availability={availability}
      />
    </>
  )
}

/** The three PeerDB items, in display order. Exported for the grid's id list. */
export function PeerDBHealthCards({
  hostId,
  source,
  sparkFor,
  variant,
  signalsFor,
  availability,
}: {
  hostId: number
  source: PeerDBHealthSource
  /** Sparkline history per item id, from the shared health history map. */
  sparkFor?: (id: string) => number[] | undefined
  variant?: HealthCardVariant
  signalsFor?: (id: string) => MetricAlertSignals
  availability?: AlertRuleStoreAvailability
}) {
  return (
    <>
      {PEERDB_HEALTH_DEFS.map((def) => (
        <PeerDBHealthCard
          key={def.id}
          def={def}
          hostId={hostId}
          source={source}
          spark={sparkFor?.(def.id)}
          variant={variant}
          signals={signalsFor?.(def.id)}
          availability={availability}
        />
      ))}
    </>
  )
}
