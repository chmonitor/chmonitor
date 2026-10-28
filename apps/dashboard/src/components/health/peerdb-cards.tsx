'use client'

/**
 * PeerDB items on the Health Summary page.
 *
 * Bespoke items, not `HEALTH_CHECKS` entries: the standard checks resolve
 * through the ClickHouse chart registry and `/api/v1/health/checks`, but PeerDB
 * is a REST source with no SQL, so a `health-*` chart entry would have to fake a
 * query (breaking the depcruise layering boundary and the dialog's "SQL query"
 * panel). Like `mutations-cards.tsx`, each card uses a local
 * `HealthCheckDef`-shaped def plus `computePeerDBCheck` in
 * `lib/health/health-status.ts`, fed by `usePeerDBMetrics`.
 *
 * Each card has its own status and links the worst mirror(s) to
 * `/peerdb/mirror?name=...`. Paused age, snapshot stalled, zero throughput and
 * last-sync age have no card: the metrics payload lacks the per-mirror
 * timestamps they need.
 *
 * The items are absent, not empty, when `PEERDB_API_URL` is unset (a green
 * "0 failed" card for a product the deployment does not run would be a lie).
 * A request that errors is shown, so an unreachable PeerDB turns the API card red.
 *
 * `chartName` is empty on purpose: it is never resolved through the registry and
 * only gives the shared shell and dialog the `HealthCheckDef` shape.
 */

import { Database, PauseCircle, PlugZap, Timer, XCircle } from 'lucide-react'

import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type {
  PeerDBCheckId,
  PeerDBHealthSource,
} from '@/lib/health/health-status'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCheckDef, RelatedLink } from './health-checks'
import type { AlertRuleStoreAvailability } from './use-alert-signals'

import { AlertConfiguredBadge } from './alert-configured-badge'
import { HealthCardShell } from './health-card-shell'
import { HealthDetailDialog } from './health-detail-dialog'
import { NO_ALERT_SIGNALS } from './use-alert-signals'
import { useState } from 'react'
import { computePeerDBCheck } from '@/lib/health/health-status'
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

const PEERDB_API_DEF: HealthCheckDef = {
  ...PEERDB_FLEET_DEF,
  id: 'peerdb-api',
  title: 'PeerDB API',
  icon: PlugZap,
  defaults: { warning: 1, critical: 1 },
  description:
    'Whether the dashboard can reach the PeerDB API with the configured credentials. Critical when the request fails: a 401/403 means PeerDB rejected the credentials, anything else means the API is unreachable or timed out. While this is red, every other PeerDB card is unknown, not healthy.',
  relatedLinks: [{ label: 'PeerDB Mirrors', href: '/peerdb' }],
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

const PEERDB_PAUSED_DEF: HealthCheckDef = {
  ...PEERDB_FLEET_DEF,
  id: 'peerdb-paused',
  title: 'PeerDB Paused Mirrors',
  icon: PauseCircle,
  defaults: { warning: 1, critical: 1 },
  description:
    'Paused or pausing PeerDB mirrors. A paused CDC mirror still holds its replication slot, so WAL keeps growing on the source. Warning only: the API does not report when the pause started, so a deliberate pause and a forgotten one look the same.',
  relatedLinks: [{ label: 'PeerDB Mirrors', href: '/peerdb' }],
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

const mb = (n: number) => `${Math.round(n).toLocaleString()} MiB`

export const PEERDB_HEALTH_DEFS: readonly HealthCheckDef[] = [
  PEERDB_FLEET_DEF,
  PEERDB_API_DEF,
  PEERDB_MIRROR_FAILURES_DEF,
  PEERDB_PAUSED_DEF,
  PEERDB_SLOT_LAG_DEF,
]

export const PEERDB_HEALTH_IDS: readonly string[] = PEERDB_HEALTH_DEFS.map(
  (d) => d.id
)

/**
 * The card's headline number, also appended to the shared sparkline history.
 * `null` while loading/unavailable, which leaves the history untouched.
 */
export function peerDBHeadlineValue(
  defId: string,
  source: PeerDBHealthSource
): number | null {
  if (defId === 'peerdb-api') {
    if (source.kind === 'loading') return null
    return source.kind === 'error' ? 1 : 0
  }
  if (source.kind !== 'data') return null
  const m = source.metrics
  switch (defId) {
    case 'peerdb-slot-lag':
      return m.maxSlotLagMb === null ? null : Math.round(m.maxSlotLagMb)
    case 'peerdb-mirror-failures':
      return m.failedMirrors.length + m.terminatedMirrors.length
    case 'peerdb-paused':
      return m.pausedMirrors.length
    default:
      return m.totalMirrors
  }
}

/** Worst mirrors first (linked to `/peerdb/mirror`), then static links, capped at the three the shell renders. */
export function peerDBCardLinks(
  def: HealthCheckDef,
  mirrors: readonly string[]
): readonly RelatedLink[] {
  const mirrorLinks = mirrors.slice(0, 2).map((name) => ({
    label: name,
    href: `/peerdb/mirror?name=${encodeURIComponent(name)}`,
  }))
  return [...mirrorLinks, ...(def.relatedLinks ?? [])].slice(0, 3)
}

function displayValueFor(defId: string, source: PeerDBHealthSource): string {
  if (defId === 'peerdb-api') {
    if (source.kind === 'loading') return '—'
    return source.kind === 'error' ? 'Down' : 'OK'
  }
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
  const computed = computePeerDBCheck(def.id as PeerDBCheckId, source)

  return (
    <>
      <HealthCardShell
        icon={def.icon}
        title={def.title}
        status={computed.status}
        displayValue={displayValueFor(def.id, source)}
        sublabel={computed.label}
        spark={spark}
        links={peerDBCardLinks(def, computed.mirrors)}
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
