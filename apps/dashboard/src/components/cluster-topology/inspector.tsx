import { CheckIcon } from 'lucide-react'

import type { ChNode, ClusterInfo, KeeperNode, TopologyModel } from './model'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ── inspector primitives (bespoke, translated from the design tokens) ──

function InsRow({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right text-[12px] font-medium tabular-nums text-foreground',
          mono && 'font-mono'
        )}
      >
        {children}
      </span>
    </div>
  )
}

/** Thin colored meter — design uses an inline bar, not the Radix Progress. */
function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: color,
        }}
      />
    </div>
  )
}

function MeterRow({
  label,
  value,
  sub,
  pct,
  color,
}: {
  label: string
  value: string
  sub?: string
  pct: number
  color: string
}) {
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
        <span className="text-[12px] font-medium tabular-nums text-foreground">
          {value}{' '}
          <span className="font-normal text-muted-foreground">{sub}</span>
        </span>
      </div>
      <Meter pct={pct} color={color} />
    </div>
  )
}

function InsSection({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h4>
        {right}
      </div>
      {children}
    </div>
  )
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
      <span className="topo-live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
      live
    </span>
  )
}

function Sparkline({
  data,
  color,
  width = 150,
  height = 34,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className="text-[10px] text-muted-foreground"
        style={{ width, height }}
      />
    )
  }
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const step = width / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / (max - min || 1)) * (height - 4) - 2
    return [x, y] as const
  })
  const id = `topo-sl-${color.replace(/[^a-z0-9]/gi, '')}`
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`
  }
  return (
    <svg width={width} height={height} className="block">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.18} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L ${width} ${height} L 0 ${height} Z`}
        fill={`url(#${id})`}
      />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

function fmtBytes(b: number): string {
  if (!b || b <= 0) return '0'
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`
}

function fmtUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

// ── public live snapshot shape consumed by the inspector ──
export interface LiveSnapshot {
  cpuPct: number | null
  memUsed: number | null
  memTotal: number | null
  diskUsed: number | null
  diskTotal: number | null
  activeQueries: number | null
  uptimeSeconds: number | null
  version: string | null
  cpuHist: number[]
  latHist: number[]
}

const EMPTY_LIVE: LiveSnapshot = {
  cpuPct: null,
  memUsed: null,
  memTotal: null,
  diskUsed: null,
  diskTotal: null,
  activeQueries: null,
  uptimeSeconds: null,
  version: null,
  cpuHist: [],
  latHist: [],
}

function membershipsOf(model: TopologyModel, id: string) {
  return model.clusters
    .filter((c) => c.members[id])
    .map((c) => ({ cl: c, role: c.members[id] }))
}

// ── ClickHouse node inspector ──
export function ChInspector({
  node,
  model,
  live,
}: {
  node: ChNode
  model: TopologyModel
  live: LiveSnapshot
}) {
  const memPct =
    live.memUsed !== null && live.memTotal
      ? (live.memUsed / live.memTotal) * 100
      : null
  const diskPct =
    live.diskUsed !== null && live.diskTotal
      ? (live.diskUsed / live.diskTotal) * 100
      : null
  const cpu = live.cpuPct
  const cpuColor =
    cpu !== null && cpu > 85
      ? 'hsl(0 84% 60%)'
      : cpu !== null && cpu > 60
        ? 'hsl(38 92% 50%)'
        : 'hsl(217 91% 60%)'
  const memColor =
    memPct !== null && memPct > 85
      ? 'hsl(0 84% 60%)'
      : memPct !== null && memPct > 65
        ? 'hsl(38 92% 50%)'
        : 'hsl(217 91% 60%)'
  const mems = membershipsOf(model, node.id)
  const isLocal = node.isLocal
  // Show live resources whenever we actually have metrics for this node — real
  // per-node numbers now come from the server-side clusterAllReplicas fan-out,
  // so remote (non-local) reachable nodes show live data too.
  const hasLive =
    live.cpuPct !== null ||
    live.memUsed !== null ||
    live.diskUsed !== null ||
    live.uptimeSeconds !== null
  const unreachable = node.status === 'unreachable'

  return (
    <>
      <InsSection
        title="Identity"
        right={
          <Badge
            variant="outline"
            className={cn(
              'border px-1.5 py-0.5 text-[10.5px]',
              node.status === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                : node.status === 'down'
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                  : node.status === 'unreachable'
                    ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
            )}
          >
            {node.status}
          </Badge>
        }
      >
        <InsRow label="Hostname" mono>
          {node.host}
        </InsRow>
        <InsRow label="IP address" mono>
          {node.address}
          <span className="text-muted-foreground">:{node.port}</span>
        </InsRow>
        <InsRow label="Shard / Replica" mono>
          {node.defaultRole
            ? `shard ${node.defaultRole.s} · replica ${node.defaultRole.r}`
            : '—'}
        </InsRow>
        <InsRow label="is_local" mono>
          {isLocal ? 'true' : 'false'}
        </InsRow>
        <InsRow label="errors_count" mono>
          <span
            className={
              node.errors > 0 ? 'text-amber-600 dark:text-amber-400' : ''
            }
          >
            {node.errors}
          </span>
        </InsRow>
        <InsRow label="slowdowns_count" mono>
          {node.slowdowns}
        </InsRow>
        {live.version && (
          <InsRow label="Version" mono>
            {live.version}
          </InsRow>
        )}
      </InsSection>

      {hasLive ? (
        <InsSection
          title="Live resources"
          right={isLocal ? <LiveTag /> : undefined}
        >
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                CPU
              </div>
              <div className="text-[22px] font-bold leading-none tabular-nums">
                {cpu !== null ? Math.round(cpu) : '—'}
                <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            {/* CPU history is captured for the local fast tick only. */}
            {isLocal && <Sparkline data={live.cpuHist} color={cpuColor} />}
          </div>
          {memPct !== null && (
            <MeterRow
              label="Memory"
              value={`${fmtBytes(live.memUsed ?? 0)} / ${fmtBytes(live.memTotal ?? 0)}`}
              pct={memPct}
              color={memColor}
            />
          )}
          {diskPct !== null && (
            <MeterRow
              label="Disk"
              value={`${fmtBytes(live.diskUsed ?? 0)} / ${fmtBytes(live.diskTotal ?? 0)}`}
              pct={diskPct}
              color={diskPct > 85 ? 'hsl(0 84% 60%)' : 'hsl(158 64% 38%)'}
            />
          )}
        </InsSection>
      ) : (
        <InsSection title="Live resources">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {unreachable
              ? 'Node unreachable in the live cluster fan-out — structural state is shown below; live metrics are intentionally not fabricated.'
              : 'Live metrics unavailable for this node (cluster fan-out not permitted, e.g. a readonly profile). Structural state is shown below.'}
          </p>
        </InsSection>
      )}

      <InsSection title="Workload">
        {live.activeQueries !== null && (
          <InsRow label="Active queries">{live.activeQueries}</InsRow>
        )}
        <InsRow label="estimated_recovery_time" mono>
          {node.recoveryTime}s
        </InsRow>
        {node.replicationLag !== null && (
          <InsRow label="replication_lag" mono>
            {node.replicationLag}s
          </InsRow>
        )}
        {live.uptimeSeconds !== null && (
          <InsRow label="Uptime" mono>
            {fmtUptime(live.uptimeSeconds)}
          </InsRow>
        )}
      </InsSection>

      <InsSection title={`Cluster memberships · ${mems.length}`}>
        <div className="space-y-1">
          {mems.map(({ cl, role }) => (
            <div
              key={cl.id}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: cl.color }}
                />
                <span className="truncate font-mono text-[12px] font-medium">
                  {cl.name}
                </span>
                {cl.kind === 'physical' && (
                  <Badge
                    variant="outline"
                    className="border-border px-1.5 py-0 text-[10px] text-muted-foreground"
                  >
                    physical
                  </Badge>
                )}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                s{role.s} · r{role.r}
              </span>
            </div>
          ))}
        </div>
        {mems.length > 1 && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Same node, different shard/replica role per cluster — virtual
            clusters overlap.
          </p>
        )}
      </InsSection>
    </>
  )
}

export function KeeperInspector({
  node,
  model,
  live,
}: {
  node: KeeperNode
  model: TopologyModel
  live: LiveSnapshot
}) {
  const isLeader = node.isLeader
  return (
    <>
      <InsSection
        title="Identity"
        right={
          <Badge
            variant="outline"
            className={cn(
              'border px-1.5 py-0.5 text-[10.5px]',
              isLeader
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
            )}
          >
            {node.role}
          </Badge>
        }
      >
        <InsRow label="Hostname" mono>
          {node.host}
        </InsRow>
        <InsRow label="Port" mono>
          {node.port}
        </InsRow>
        <InsRow label="Cluster" mono>
          {node.clusterName}
        </InsRow>
        <InsRow label="Version" mono>
          {node.version}
        </InsRow>
      </InsSection>

      <InsSection title="Raft state" right={<LiveTag />}>
        <InsRow label="Role" mono>
          {node.role}
        </InsRow>
        <InsRow label="Leader" mono>
          {model.leaderId ?? '—'}
        </InsRow>
        <InsRow label="Connected" mono>
          {node.isConnected ? 'true' : 'false'}
        </InsRow>
        <InsRow label="Outstanding req." mono>
          {node.outstanding}
        </InsRow>
        <InsRow label="Watch count" mono>
          {node.watchCount.toLocaleString()}
        </InsRow>
        <InsRow label="Znode count" mono>
          {node.znodeCount.toLocaleString()}
        </InsRow>
      </InsSection>

      <InsSection title="Latency">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              avg request
            </div>
            <div className="text-[22px] font-bold leading-none tabular-nums">
              {node.avgLatency ? node.avgLatency.toFixed(2) : '—'}
              <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">
                ms
              </span>
            </div>
          </div>
          <Sparkline data={live.latHist} color="hsl(158 64% 38%)" />
        </div>
      </InsSection>
    </>
  )
}

export function ClusterOverview({
  model,
  live,
}: {
  model: TopologyModel
  live: LiveSnapshot
}) {
  const avgLat =
    model.keepers.length > 0
      ? model.keepers.reduce((s, k) => s + k.avgLatency, 0) /
        model.keepers.length
      : null
  const znodes = model.keepers.reduce((s, k) => s + k.znodeCount, 0)
  const hasKeeper = model.keepers.length > 0

  return (
    <>
      <InsSection
        title="Keeper quorum"
        right={
          hasKeeper ? (
            model.quorumHealthy ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10.5px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              >
                <CheckIcon className="mr-1 h-2.5 w-2.5" />
                healthy
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              >
                degraded
              </Badge>
            )
          ) : (
            <Badge
              variant="outline"
              className="border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
            >
              unavailable
            </Badge>
          )
        }
      >
        {hasKeeper ? (
          <>
            <InsRow label="Members">
              {model.keepers.length} node{model.keepers.length === 1 ? '' : 's'}{' '}
              · quorum {Math.floor(model.keepers.length / 2) + 1}
            </InsRow>
            <InsRow label="Leader" mono>
              {model.leaderId ?? '—'}
            </InsRow>
            <InsRow label="Avg latency" mono>
              {avgLat !== null ? `${avgLat.toFixed(2)} ms` : '—'}
            </InsRow>
            <InsRow label="Znodes" mono>
              {znodes.toLocaleString()}
            </InsRow>
          </>
        ) : (
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            No coordination layer detected — this cluster uses Distributed
            routing without ReplicatedMergeTree, or Keeper / ZooKeeper is not
            configured. Cluster structure is shown without coordination details.
          </p>
        )}
      </InsSection>

      <InsSection
        title="Virtual clusters"
        right={
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {model.clusters.length}
          </span>
        }
      >
        <div className="space-y-1.5">
          {model.clusters.map((cl: ClusterInfo) => (
            <div
              key={cl.id}
              className="rounded-lg border border-border px-2.5 py-2"
            >
              <div className="mb-0.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  {cl.outline ? (
                    <span
                      className="h-2.5 w-2.5 rounded-sm border-2 border-dotted"
                      style={{ borderColor: cl.color }}
                    />
                  ) : (
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: cl.color }}
                    />
                  )}
                  <span className="font-mono text-[12.5px] font-semibold">
                    {cl.name}
                  </span>
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {cl.nodeCount} node{cl.nodeCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">{cl.topo}</div>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
          Nodes can join several clusters at once — overlaps show where the
          hulls intersect.
        </p>
      </InsSection>

      <InsSection title="Totals">
        {live.activeQueries !== null && (
          <InsRow label="Active queries (local)">{live.activeQueries}</InsRow>
        )}
        <InsRow label="Nodes">
          {model.counts.nodes} · {model.counts.keepers} Keeper /{' '}
          {model.counts.chNodes} ClickHouse
        </InsRow>
        <InsRow label="Clusters">
          {model.counts.clusters} ({model.counts.physical} physical ·{' '}
          {model.counts.logical} logical)
        </InsRow>
        {model.meta.truncated && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Showing {model.chNodes.length} of {model.counts.chNodes} ClickHouse
            nodes — {model.meta.hiddenChNodes} hidden for readability. All nodes
            remain counted above.
          </p>
        )}
      </InsSection>
    </>
  )
}

export { EMPTY_LIVE }
