import {
  BoxesIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  RefreshCwIcon,
  ShieldIcon,
  XIcon,
} from 'lucide-react'

import type { ClusterLiveMetricsRow } from '@/lib/query-config/system/cluster-live-metrics'
import type { LiveSnapshot } from './inspector'
import type { ChNode, NodeLiveMetrics, TopologyData } from './model'

import {
  ChInspector,
  ClusterOverview,
  EMPTY_LIVE,
  KeeperInspector,
} from './inspector'
import { isKeeperNode, layoutTopology, STATUS_COLOR } from './model'
import { TopoCanvas } from './topo-canvas'
import { useTopology } from './use-topology'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTableData } from '@/lib/swr'
import { cn } from '@/lib/utils'

// Refresh cadence for the connected node's fast live tick.
const LIVE_INTERVAL = 8_000 // 8s
const HIST_LEN = 28

// Empty model used while the topology document loads (keeps useMemo non-null).
const EMPTY_TOPOLOGY: TopologyData = {
  keepers: [],
  chNodes: [],
  clusters: [],
  raftEdges: [],
  replEdges: [],
  coordEdges: [],
  keeper: {
    present: false,
    source: 'none',
    leaderId: null,
    quorumHealthy: false,
  },
  meta: {
    counts: {
      nodes: 0,
      keepers: 0,
      chNodes: 0,
      clusters: 0,
      physical: 0,
      logical: 0,
    },
    truncated: false,
    hiddenChNodes: 0,
    liveSource: 'none',
  },
}

/** Build a LiveSnapshot for the inspector from a node's server-side live metrics. */
function snapshotFromNode(
  live: NodeLiveMetrics | null,
  latHist: number[]
): LiveSnapshot {
  if (!live) return { ...EMPTY_LIVE, latHist }
  return {
    cpuPct: live.cpuPct,
    memUsed: live.memUsed,
    memTotal: live.memTotal,
    diskUsed: live.diskUsed,
    diskTotal: live.diskTotal,
    activeQueries: live.activeQueries,
    uptimeSeconds: live.uptimeSeconds,
    version: live.version,
    cpuHist: [],
    latHist,
  }
}

// ── summary pill ──
function Pill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  tone?: string
}) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3">
      <Icon className="h-[13px] w-[13px] text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-[12.5px] font-semibold tabular-nums',
          tone || 'text-foreground'
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function TopologyView({
  hostId,
  detailHref,
}: {
  hostId: number
  /** When set (e.g. embedded on the overview tab), shows a link through to the
   * full cluster page for more detail. Omitted on the /clusters page itself. */
  detailHref?: string
}) {
  // ── structural model assembled server-side (cached hard) ──
  // Real per-node live metrics for EVERY node are included in this document
  // (server-side clusterAllReplicas fan-out), refreshed every 60s.
  const {
    topology,
    error: clusterError,
    isLoading: clusterLoading,
    refresh: refreshTopology,
  } = useTopology(hostId)

  // ── live metrics for the connected node (fast interval, separate key) ──
  // Overlays sub-8s freshness onto the LOCAL node only; remote nodes use the
  // 60s server-side snapshot above.
  const { data: liveRows, refresh: refreshLive } =
    useTableData<ClusterLiveMetricsRow>(
      'cluster-live-metrics',
      hostId,
      undefined,
      LIVE_INTERVAL
    )

  // ── physical/implicit clusters (all-replicated, all-sharded, default) are
  // HIDDEN by default — they are structural scaffolding that clutters the graph.
  // A legend toggle reveals them (rendered solid + slate, a bit different). ──
  const [showPhysical, setShowPhysical] = useState(false)

  // ── model: layout applied client-side; rebuilt ONLY when structure or the
  // physical-visibility toggle changes (toggling drops the outer rings + shrinks
  // the viewBox; node positions are logical-driven so they never move). ──
  const model = useMemo(
    () => layoutTopology(topology ?? EMPTY_TOPOLOGY, { showPhysical }),
    [topology, showPhysical]
  )

  const liveRow = liveRows?.[0]

  // ── live history ring buffer (only the live bit re-renders) ──
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const lastCpuRef = useRef<number | null>(null)
  useEffect(() => {
    const cpu = liveRow?.cpu_pct
    if (cpu === undefined || cpu === null) return
    const n = Number(cpu)
    if (!Number.isFinite(n)) return
    if (lastCpuRef.current === n) return
    lastCpuRef.current = n
    setCpuHist((prev) => [...prev.slice(-(HIST_LEN - 1)), n])
  }, [liveRow?.cpu_pct])

  // Keeper latency history (avg across keepers).
  const [latHist, setLatHist] = useState<number[]>([])
  useEffect(() => {
    if (model.keepers.length === 0) return
    const avg =
      model.keepers.reduce((s, k) => s + k.avgLatency, 0) / model.keepers.length
    if (!Number.isFinite(avg) || avg <= 0) return
    setLatHist((prev) => [...prev.slice(-(HIST_LEN - 1)), avg])
  }, [model.keepers])

  // ── selection + cluster filter ──
  const [selected, setSelected] = useState<string | null>(null)
  const [activeCluster, setActiveCluster] = useState<string | null>(null)
  const [secsAgo, setSecsAgo] = useState(0)

  // A hidden physical cluster must not act as the filter — its hull isn't drawn,
  // so it would fade every visible hull with no anchor. Derive the EFFECTIVE
  // active cluster in-render (rather than clearing via an effect, which would dim
  // everything for one frame); toggling physical back on restores the filter.
  const effectiveActiveCluster =
    activeCluster &&
    (showPhysical || !model.clusterById[activeCluster]?.outline)
      ? activeCluster
      : null

  useEffect(() => {
    setSecsAgo(0)
  }, [])
  useEffect(() => {
    const t = setInterval(() => setSecsAgo((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // ── fast-tick live snapshot for the LOCAL node (overrides the 60s server one) ──
  const fastLocalLive: NodeLiveMetrics | null = useMemo(() => {
    if (!liveRow) return null
    const n = (v: unknown) => {
      const x = Number(v)
      return Number.isFinite(x) ? x : null
    }
    return {
      cpuPct: n(liveRow.cpu_pct),
      memUsed: n(liveRow.mem_used_bytes),
      memTotal: n(liveRow.mem_total_bytes),
      memAvailable: n(liveRow.mem_available_bytes),
      diskUsed: n(liveRow.disk_used_bytes),
      diskTotal: n(liveRow.disk_total_bytes),
      activeQueries: n(liveRow.active_queries),
      uptimeSeconds: n(liveRow.uptime_seconds),
      version: liveRow.version ?? null,
    }
  }, [liveRow])

  // Effective live metrics for a node: fast tick for local, else server snapshot.
  const liveForNode = (node: ChNode): NodeLiveMetrics | null =>
    node.isLocal && fastLocalLive ? fastLocalLive : node.live

  // Live rings for the canvas — REAL per-node CPU/mem for every reachable node.
  const liveById = useMemo(() => {
    const map: Record<
      string,
      { cpuPct: number | null; memPct: number | null }
    > = {}
    for (const node of model.chNodes) {
      const live = node.isLocal && fastLocalLive ? fastLocalLive : node.live
      if (!live) continue
      const memPct =
        live.memUsed !== null && live.memTotal && live.memTotal > 0
          ? (live.memUsed / live.memTotal) * 100
          : null
      map[node.id] = { cpuPct: live.cpuPct, memPct }
    }
    return map
  }, [model.chNodes, fastLocalLive])

  // full live snapshot for the inspector (local node, fast tick + cpu history)
  const localSnapshot: LiveSnapshot = useMemo(() => {
    if (!fastLocalLive) return { ...EMPTY_LIVE, latHist }
    return {
      cpuPct: fastLocalLive.cpuPct,
      memUsed: fastLocalLive.memUsed,
      memTotal: fastLocalLive.memTotal,
      diskUsed: fastLocalLive.diskUsed,
      diskTotal: fastLocalLive.diskTotal,
      activeQueries: fastLocalLive.activeQueries,
      uptimeSeconds: fastLocalLive.uptimeSeconds,
      version: fastLocalLive.version,
      cpuHist,
      latHist,
    }
  }, [fastLocalLive, cpuHist, latHist])

  const selectedNode = selected ? (model.nodeById[selected] ?? null) : null

  const handleRefresh = () => {
    refreshTopology()
    refreshLive()
  }

  const hasTopology = !!topology && model.chNodes.length > 0

  // ── loading / empty states ──
  if (clusterLoading && !hasTopology) {
    return <TopologySkeleton />
  }

  if (clusterError && !hasTopology) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">
          Failed to load cluster topology: {clusterError.message}
        </p>
      </Card>
    )
  }

  if (!hasTopology) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          No clusters found in system.clusters for this host.
        </p>
      </Card>
    )
  }

  const dfltCluster =
    model.clusters.find((c) => c.name === 'default')?.name ??
    model.clusters[0]?.name ??
    '—'
  const leaderLabel = model.leaderId ? `leader ${model.leaderId}` : '—'
  // Count of physical/implicit clusters — drives the legend show/hide toggle.
  const physicalCount = model.clusters.filter((c) => c.outline).length

  return (
    <div className="max-w-[1640px]">
      {/* status strip */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2">
            <span
              className={cn(
                'absolute inset-0 rounded-full',
                model.quorumHealthy || model.keepers.length === 0
                  ? 'topo-live-dot bg-emerald-500'
                  : 'bg-amber-500'
              )}
            />
            <span
              className={cn(
                'relative h-2 w-2 rounded-full',
                model.quorumHealthy || model.keepers.length === 0
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
              )}
            />
          </span>
          <span className="text-[12.5px] font-medium">
            {model.keepers.length === 0
              ? 'Cluster online'
              : model.quorumHealthy
                ? 'Quorum healthy · all replicas online'
                : 'Quorum degraded'}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            · cluster <span className="font-mono">{dfltCluster}</span> · updated{' '}
            <span className="tabular-nums">{secsAgo}s</span> ago
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[12px]"
            onClick={handleRefresh}
          >
            <RefreshCwIcon className="h-3 w-3" />
            Refresh
          </Button>
          {detailHref && (
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[12px]"
              render={<Link href={detailHref} />}
            >
              <ExternalLinkIcon className="h-3 w-3" />
              Cluster details
            </Button>
          )}
        </div>
      </div>

      {/* summary pills */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill icon={BoxesIcon} label="Nodes" value={model.counts.nodes} />
        <Pill
          icon={ShieldIcon}
          label="Keeper"
          value={`${model.counts.keepers} · ${leaderLabel}`}
        />
        <Pill
          icon={DatabaseIcon}
          label="ClickHouse"
          value={model.counts.chNodes}
        />
        <Pill
          icon={HashIcon}
          label="Clusters"
          value={`${model.counts.clusters} (${model.counts.physical} physical · ${model.counts.logical} logical)`}
        />
        {localSnapshot.activeQueries !== null && (
          <Pill
            icon={RefreshCwIcon}
            label="Active queries"
            value={localSnapshot.activeQueries}
            tone="text-amber-600 dark:text-amber-400"
          />
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[1fr_360px]">
        {/* canvas */}
        <Card className="overflow-hidden">
          {/* legend toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Clusters
              </span>
              {model.clusters
                // Physical/implicit clusters only appear when toggled on.
                .filter((cl) => showPhysical || !cl.outline)
                .map((cl) => {
                  const on = activeCluster === cl.id
                  return (
                    <button
                      type="button"
                      key={cl.id}
                      onClick={() => setActiveCluster(on ? null : cl.id)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
                        on
                          ? 'border-foreground/30 bg-muted text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: cl.color }}
                      />
                      <span className="font-mono">{cl.name}</span>
                    </button>
                  )
                })}
              {/* toggle: reveal/hide the implicit (physical) clusters. */}
              {physicalCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPhysical((v) => !v)}
                  aria-pressed={showPhysical}
                  title={
                    showPhysical
                      ? 'Hide implicit clusters (all-replicated, all-sharded, default)'
                      : 'Show implicit clusters (all-replicated, all-sharded, default)'
                  }
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
                    showPhysical
                      ? 'border-foreground/30 bg-muted text-foreground'
                      : 'border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {showPhysical ? (
                    <EyeOffIcon className="h-3 w-3" />
                  ) : (
                    <EyeIcon className="h-3 w-3" />
                  )}
                  {showPhysical
                    ? 'Hide implicit'
                    : `Implicit (${physicalCount})`}
                </button>
              )}
              {effectiveActiveCluster && (
                <button
                  type="button"
                  onClick={() => setActiveCluster(null)}
                  className="ml-1 text-[11px] text-muted-foreground underline hover:text-foreground"
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
                  <rect
                    x="1.5"
                    y="1.5"
                    width="10"
                    height="10"
                    rx="2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
                ClickHouse
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
                  <path
                    d="M6.5 1 L11 3.6 V8.4 L6.5 11 L2 8.4 V3.6 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                Keeper
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-full"
                  style={{ background: '#3b82f6', opacity: 0.6 }}
                />
                replication
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-4 border-t-2 border-dashed"
                  style={{
                    borderColor: 'var(--muted-foreground)',
                    opacity: 0.5,
                  }}
                />
                coordination
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                healthy
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                warn
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                unreachable
              </span>
            </div>
          </div>
          {/* Scrolls horizontally on narrow screens (min-width) so the wide
              topology stays readable instead of shrinking to fit. */}
          <div className="h-[480px] overflow-x-auto bg-muted/60 sm:h-[540px]">
            <div className="h-full w-full min-w-[720px]">
              <TopoCanvas
                model={model}
                liveById={liveById}
                selected={selected}
                activeCluster={effectiveActiveCluster}
                onSelect={setSelected}
                onClearSelect={() => setSelected(null)}
              />
            </div>
          </div>
        </Card>

        {/* inspector */}
        <Card className="overflow-hidden xl:sticky xl:top-4">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Inspector
              </div>
              <div className="mt-0.5 flex items-center gap-2 truncate text-[14px] font-semibold">
                {selectedNode ? (
                  <>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: isKeeperNode(selectedNode)
                          ? selectedNode.isLeader
                            ? STATUS_COLOR.warn
                            : STATUS_COLOR.healthy
                          : STATUS_COLOR[selectedNode.status],
                      }}
                    />
                    <span className="font-mono">{selectedNode.id}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {isKeeperNode(selectedNode) ? 'Keeper' : 'ClickHouse'}
                    </span>
                  </>
                ) : (
                  <span>Cluster overview</span>
                )}
              </div>
            </div>
            {selectedNode && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Close inspector"
              >
                <XIcon className="h-[15px] w-[15px]" />
              </button>
            )}
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {!selectedNode && (
              <ClusterOverview model={model} live={localSnapshot} />
            )}
            {selectedNode && !isKeeperNode(selectedNode) && (
              <ChInspector
                node={selectedNode}
                model={model}
                live={
                  selectedNode.isLocal
                    ? localSnapshot
                    : snapshotFromNode(liveForNode(selectedNode), latHist)
                }
              />
            )}
            {selectedNode && isKeeperNode(selectedNode) && (
              <KeeperInspector
                node={selectedNode}
                model={model}
                live={localSnapshot}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function TopologySkeleton() {
  return (
    <div className="max-w-[1640px]">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
        <Skeleton className="h-[540px] w-full rounded-xl" />
        <Skeleton className="h-[540px] w-full rounded-xl" />
      </div>
    </div>
  )
}
