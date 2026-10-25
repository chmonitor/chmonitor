import { RefreshCw } from 'lucide-react'

import type { ReactNode } from 'react'
import type { HealthStatus } from '@/lib/health/health-status'
import type { HistoryMap } from '@/lib/health/history-storage'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCounts } from './health-summary-banner'

import { AlertDeliveryNotice } from './alert-delivery-notice'
import { HealthCard } from './health-card'
import { HEALTH_CHECKS } from './health-checks'
import { HealthSummaryBanner } from './health-summary-banner'
import { RunningMutationsCard, StuckMutationsCard } from './mutations-cards'
import {
  PEERDB_HEALTH_DEFS,
  PEERDB_HEALTH_IDS,
  PeerDBHealthCard,
  peerDBHeadlineValue,
} from './peerdb-cards'
import { signalsForCheck, useAlertSignals } from './use-alert-signals'
import { EMPTY_STATE, useHealthChecks } from './use-health-checks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePeerDBMetrics } from '@/components/peerdb/use-peerdb-metrics'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useVisibleInterval } from '@/hooks/use-visible-interval'
import {
  alertStatusKey,
  dispatchAlert,
  dispatchRecovery,
  healthIncidentId,
  isEscalation,
  loadAlertStatuses,
  saveAlertStatuses,
} from '@/lib/health/alert-dispatcher'
import {
  computeCheckStatus,
  computePeerDBCheck,
  computeRunningMutations,
  computeStuckMutations,
  type PeerDBCheckId,
  type PeerDBHealthSource,
  SEVERITY_RANK,
} from '@/lib/health/health-status'
import {
  appendPoint,
  historyKey,
  loadHistory,
  saveHistory,
} from '@/lib/health/history-storage'
import {
  loadThresholds,
  type ThresholdsMap,
} from '@/lib/health/thresholds-storage'
import { useHostId } from '@/lib/swr'
import { track } from '@/lib/telemetry'
import { cn } from '@/lib/utils'

const STUCK_MUTATIONS_CHART = 'summary-stuck-mutations'
const RUNNING_MUTATIONS_CHART = 'summary-used-by-mutations'

/** Stable module-level identity, so `useMemo` is not re-run every render. */
const EMPTY_THRESHOLDS: ThresholdsMap = {}

type Filter = 'all' | 'issues' | 'healthy'

interface GridItem {
  id: string
  status: HealthStatus
  /** Numeric value tracked in the sparkline history (null when unavailable). */
  sparkValue: number | null
  order: number
  /** Alert payload, dispatched on escalation regardless of the active filter. */
  alert: { title: string; value: number | null; label: string }
  render: (spark: number[] | undefined, variant: HealthCardVariant) => ReactNode
}

function formatAgo(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export function HealthGrid() {
  const hostId = useHostId()
  // `null` = localStorage not read yet, which is what lets the alert-signal
  // hook tell "no thresholds tuned" from "we have not looked yet".
  const [overrides, setOverrides] = useState<ThresholdsMap | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [history, setHistory] = useState<HistoryMap>(() => loadHistory())

  useEffect(() => {
    setOverrides(loadThresholds())
    const handler = () => setOverrides(loadThresholds())
    window.addEventListener('health-thresholds-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('health-thresholds-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  useEffect(() => {
    track('health_viewed')
  }, [])

  const chartNames = useMemo(
    () => [
      ...HEALTH_CHECKS.map((c) => c.chartName),
      STUCK_MUTATIONS_CHART,
      RUNNING_MUTATIONS_CHART,
    ],
    []
  )

  // "Already alerting" state for every check, resolved once for the page rather
  // than per card.
  const itemIds = useMemo(
    () => [
      ...HEALTH_CHECKS.map((c) => c.id),
      'stuck-mutations',
      'running-mutations',
      ...PEERDB_HEALTH_IDS,
    ],
    []
  )
  const { signalsByCheck, availability: alertStoreAvailability } =
    useAlertSignals(itemIds, overrides)

  // PeerDB is a bespoke health group: it arrives over PeerDB REST, not
  // through the ClickHouse chart registry, so it has its own hook and its own
  // `computeX`. `configured: false` means `PEERDB_API_URL` is unset — the whole
  // group is then ABSENT rather than a row of green zeros for a product this
  // deployment does not run.
  const peerDB = usePeerDBMetrics()
  // A failed request is shown too: the not-configured branch answers 200, so an
  // error only happens on a configured deployment — and an unreachable PeerDB
  // must turn the API card red, not hide the group.
  const peerDBShown = peerDB.data?.configured === true || Boolean(peerDB.error)
  const peerDBSource: PeerDBHealthSource = peerDB.isPending
    ? { kind: 'loading' }
    : peerDB.error
      ? { kind: 'error', message: peerDB.error.message }
      : peerDB.data
        ? { kind: 'data', metrics: peerDB.data.metrics }
        : { kind: 'loading' }

  const { results, isLoading, isValidating, dataUpdatedAt } = useHealthChecks(
    chartNames,
    hostId
  )

  const items = useMemo<GridItem[]>(() => {
    const list: GridItem[] = []
    let order = 0
    const tuned = overrides ?? EMPTY_THRESHOLDS

    for (const check of HEALTH_CHECKS) {
      const thresholds = tuned[check.id] ?? check.defaults
      const result = results[check.chartName] ?? EMPTY_STATE
      const computed = computeCheckStatus(check, thresholds, result, isLoading)
      list.push({
        id: check.id,
        status: computed.status,
        sparkValue: computed.value,
        order: order++,
        alert: {
          title: check.title,
          value: computed.value,
          label: computed.label,
        },
        render: (spark, variant) => (
          <HealthCard
            key={check.id}
            check={check}
            thresholds={thresholds}
            hostId={hostId}
            computed={computed}
            spark={spark}
            clickhouseVersion={result.clickhouseVersion}
            variant={variant}
            signals={signalsForCheck(signalsByCheck, check.id)}
            availability={alertStoreAvailability}
          />
        ),
      })
    }

    const stuck = computeStuckMutations(
      results[STUCK_MUTATIONS_CHART] ?? EMPTY_STATE,
      isLoading
    )
    list.push({
      id: 'stuck-mutations',
      status: stuck.status,
      sparkValue: stuck.value,
      order: order++,
      alert: {
        title: 'Stuck Mutations',
        value: stuck.value,
        label: stuck.label,
      },
      render: (spark, variant) => (
        <StuckMutationsCard
          key="stuck-mutations"
          hostId={hostId}
          computed={stuck}
          spark={spark}
          clickhouseVersion={results[STUCK_MUTATIONS_CHART]?.clickhouseVersion}
          variant={variant}
          signals={signalsForCheck(signalsByCheck, 'stuck-mutations')}
          availability={alertStoreAvailability}
        />
      ),
    })

    const running = computeRunningMutations(
      results[RUNNING_MUTATIONS_CHART] ?? EMPTY_STATE,
      isLoading
    )
    list.push({
      id: 'running-mutations',
      status: running.status,
      sparkValue: running.value,
      order: order++,
      alert: {
        title: 'Running Mutations',
        value: running.value,
        label: running.label,
      },
      render: (spark, variant) => (
        <RunningMutationsCard
          key="running-mutations"
          hostId={hostId}
          computed={running}
          spark={spark}
          clickhouseVersion={
            results[RUNNING_MUTATIONS_CHART]?.clickhouseVersion
          }
          variant={variant}
          signals={signalsForCheck(signalsByCheck, 'running-mutations')}
          availability={alertStoreAvailability}
        />
      ),
    })

    // PeerDB group: omitted when not configured. One item per card so each
    // sorts, counts, and filters on its own.
    if (peerDBShown) {
      for (const def of PEERDB_HEALTH_DEFS) {
        const peerDBCheck = computePeerDBCheck(
          def.id as PeerDBCheckId,
          peerDBSource
        )
        list.push({
          id: def.id,
          status: peerDBCheck.status,
          sparkValue: peerDBHeadlineValue(def.id, peerDBSource),
          order: order++,
          alert: {
            title: def.title,
            value: peerDBHeadlineValue(def.id, peerDBSource),
            label: peerDBCheck.label,
          },
          render: (spark, variant) => (
            <PeerDBHealthCard
              key={def.id}
              def={def}
              hostId={hostId}
              source={peerDBSource}
              spark={spark}
              variant={variant}
              signals={signalsForCheck(signalsByCheck, def.id)}
              availability={alertStoreAvailability}
            />
          ),
        })
      }
    }

    return list
  }, [
    results,
    overrides,
    isLoading,
    hostId,
    signalsByCheck,
    alertStoreAvailability,
    peerDBShown,
    peerDBSource,
  ])

  // Keep the latest items reachable from refresh-gated effects without
  // re-running them on every render.
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (isLoading || dataUpdatedAt === 0) return
    setHistory((prev) => {
      const next = { ...prev }
      let changed = false
      for (const item of itemsRef.current) {
        if (item.sparkValue === null || !Number.isFinite(item.sparkValue)) {
          continue
        }
        next[historyKey(hostId, item.id)] = appendPoint(
          prev[historyKey(hostId, item.id)],
          item.sparkValue
        )
        changed = true
      }
      if (!changed) return prev
      saveHistory(next)
      return next
    })
  }, [dataUpdatedAt, hostId, isLoading])

  // Dispatch alerts on escalation for ALL checks, independent of the filter, so
  // hiding a card never silences its alert. Last-seen status is persisted per
  // `host::checkId` in localStorage (not a per-instance ref), so escalation
  // state survives component remount / navigation: returning to /health does
  // NOT re-fire an alert whose status has not changed. On de-escalation back to
  // `ok`, a recovery event is emitted so downstream consumers can clear it.
  useEffect(() => {
    // `dataUpdatedAt` re-runs this on each refresh; skip before the first fetch.
    if (isLoading || dataUpdatedAt === 0) return
    const statuses = loadAlertStatuses()
    let changed = false
    for (const item of itemsRef.current) {
      const s = item.status
      if (s !== 'ok' && s !== 'warning' && s !== 'critical') continue
      const key = alertStatusKey(hostId, item.id)
      const prev = statuses[key] ?? null
      if (isEscalation(prev, s) && s !== 'ok') {
        void dispatchAlert({
          checkId: item.id,
          title: item.alert.title,
          severity: s,
          value: item.alert.value,
          label: item.alert.label,
          hostId,
          incidentId: healthIncidentId(hostId, item.id, s),
        })
      } else if (s === 'ok' && (prev === 'warning' || prev === 'critical')) {
        void dispatchRecovery({
          checkId: item.id,
          title: item.alert.title,
          severity: prev,
          value: item.alert.value,
          label: item.alert.label,
          hostId,
          incidentId: healthIncidentId(hostId, item.id, prev),
        })
      }
      if (statuses[key] !== s) {
        statuses[key] = s
        changed = true
      }
    }
    if (changed) saveAlertStatuses(statuses)
  }, [dataUpdatedAt, hostId, isLoading])

  const counts = useMemo<HealthCounts>(() => {
    const c: HealthCounts = { critical: 0, warning: 0, ok: 0 }
    for (const item of items) {
      if (item.status === 'critical') c.critical++
      else if (item.status === 'warning') c.warning++
      else if (item.status === 'ok') c.ok++
    }
    return c
  }, [items])

  const visible = useMemo(() => {
    const matches = (s: HealthStatus) =>
      filter === 'all'
        ? true
        : filter === 'issues'
          ? s === 'critical' || s === 'warning'
          : s === 'ok'
    return items
      .filter((i) => matches(i.status))
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.status] - SEVERITY_RANK[b.status] || a.order - b.order
      )
  }, [items, filter])

  const [now, setNow] = useState(() => Date.now())
  useVisibleInterval(() => setNow(Date.now()), 5000)

  return (
    <div className="flex flex-col gap-4">
      <HealthSummaryBanner counts={counts} />

      {/* PeerDB alerts only reach a channel through the scheduled sweep. */}
      {peerDBShown ? <AlertDeliveryNotice hostId={hostId} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All {items.length}</TabsTrigger>
            <TabsTrigger value="issues">
              Needs attention {counts.critical + counts.warning}
            </TabsTrigger>
            <TabsTrigger value="healthy">Healthy {counts.ok}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw
            className={cn('size-3.5', isValidating && 'animate-spin')}
            aria-hidden
          />
          <span>
            Auto-refresh
            {dataUpdatedAt > 0 &&
              ` · checked ${formatAgo(now - dataUpdatedAt)}`}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {filter === 'issues'
            ? 'Nothing needs attention right now.'
            : filter === 'healthy'
              ? 'No healthy checks right now.'
              : 'No health checks to show.'}
        </div>
      ) : (
        <HealthResults items={visible} history={history} hostId={hostId} />
      )}
    </div>
  )
}

/**
 * Two tiers so problems dominate: issues (critical / warning) as full cards on
 * top, everything else (ok / unavailable) as one dense list of rows. `items` is
 * already sorted and filtered upstream, so this also drives the filter tabs.
 */
function HealthResults({
  items,
  history,
  hostId,
}: {
  items: GridItem[]
  history: HistoryMap
  hostId: number
}) {
  const cardItems = items.filter(
    (i) => i.status === 'critical' || i.status === 'warning'
  )
  const rowItems = items.filter(
    (i) => i.status !== 'critical' && i.status !== 'warning'
  )
  const spark = (item: GridItem) => history[historyKey(hostId, item.id)]

  return (
    <div className="flex flex-col gap-6">
      {cardItems.length > 0 && (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {cardItems.map((item) => item.render(spark(item), 'card'))}
        </div>
      )}

      {rowItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Only label the quiet list when issues sit above it — the loud →
              calm transition needs a marker; a filtered-only view does not. */}
          {cardItems.length > 0 && (
            <div className="px-1 text-[11px] max-sm:text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Operational · {rowItems.length}
            </div>
          )}
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {rowItems.map((item) => item.render(spark(item), 'row'))}
          </div>
        </div>
      )}
    </div>
  )
}
