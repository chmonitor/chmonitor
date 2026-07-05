import { Database, Layers, ServerCrash, Wifi, WifiOff } from 'lucide-react'

import { memo, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  detectKeeperType,
  type KeeperType,
} from '@/lib/keeper/detect-keeper-type'
import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeeperInfoRow {
  zookeeper_cluster_name: string
  host: string
  port: number | string
  is_connected: boolean | number | string
  server_state: string
  is_leader: boolean | number | string
  version: string
  avg_latency: number | string
  min_latency: number | string
  max_latency: number | string
  znode_count: number | string
  watch_count: number | string
  ephemerals_count: number | string
  approximate_data_size: number | string
  readable_approximate_data_size: string
  packets_received: number | string
  packets_sent: number | string
  outstanding_requests: number | string
  followers: number | string
  synced_followers: number | string
  zxid: number | string
  last_log_idx: number | string
  last_committed_idx: number | string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a value that may arrive as boolean, number, or string "1"/"true". */
function isTruthy(v: boolean | number | string | undefined): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true'
  return false
}

function num(v: number | string | undefined): number {
  return Number(v ?? 0)
}

/** Format a latency value (stored as milliseconds) with one decimal. */
function fmtMs(v: number | string | undefined): string {
  const n = num(v)
  return n === 0
    ? '0 ms'
    : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`
}

/** Format a large integer compactly (e.g. 1 234 567 → "1.23M"). */
function fmtCount(v: number | string | undefined): string {
  const n = num(v)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

type RoleVariant = 'leader' | 'follower' | 'observer' | 'standalone'

function deriveRole(row: KeeperInfoRow): RoleVariant {
  const state = (row.server_state ?? '').toLowerCase()
  if (state === 'leader' || isTruthy(row.is_leader)) return 'leader'
  if (state === 'follower') return 'follower'
  if (state === 'observer') return 'observer'
  return 'standalone'
}

const ROLE_STYLES: Record<RoleVariant, string> = {
  leader:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300',
  follower:
    'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/60 dark:bg-blue-900/20 dark:text-blue-300',
  observer:
    'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700/60 dark:bg-violet-900/20 dark:text-violet-300',
  standalone:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300',
}

const ROLE_LABEL: Record<RoleVariant, string> = {
  leader: 'Leader',
  follower: 'Follower',
  observer: 'Observer',
  standalone: 'Standalone',
}

function RoleBadge({ role }: { role: RoleVariant }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10.5px] font-semibold px-1.5 py-0',
        ROLE_STYLES[role]
      )}
    >
      {ROLE_LABEL[role]}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Keeper-type badge
// ---------------------------------------------------------------------------

const KEEPER_TYPE_STYLES: Record<KeeperType, string> = {
  'clickhouse-keeper':
    'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700/60 dark:bg-orange-900/20 dark:text-orange-300',
  zookeeper:
    'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-700/60 dark:bg-cyan-900/20 dark:text-cyan-300',
  unknown: 'border-border bg-muted/40 text-muted-foreground',
}

const KEEPER_TYPE_LABEL: Record<KeeperType, string> = {
  'clickhouse-keeper': 'ClickHouse Keeper',
  zookeeper: 'ZooKeeper',
  unknown: 'Unknown',
}

function KeeperTypeBadge({ version }: { version: string | undefined }) {
  const type = detectKeeperType(version)
  const label = KEEPER_TYPE_LABEL[type]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn(
              'text-[10.5px] font-semibold px-1.5 py-0 cursor-default',
              KEEPER_TYPE_STYLES[type]
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-center">
        {version ? `Detected from version: ${version}` : 'Version not reported'}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Metric row inside a card
// ---------------------------------------------------------------------------

function MetricRow({
  label,
  value,
  className,
}: {
  label: string
  value: string | number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 min-w-0',
        className
      )}
    >
      <span className="shrink-0 text-[11px] text-muted-foreground leading-snug">
        {label}
      </span>
      <span className="truncate text-right font-mono text-[11.5px] tabular-nums text-foreground/85">
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single node card
// ---------------------------------------------------------------------------

const NodeCard = memo(function NodeCard({ row }: { row: KeeperInfoRow }) {
  const connected = isTruthy(row.is_connected)
  const role = deriveRole(row)
  const isStandalone = role === 'standalone'
  const raftLag = num(row.last_log_idx) - num(row.last_committed_idx)

  return (
    <Card className="flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <CardHeader className="flex flex-row flex-wrap items-start gap-2 p-3 pb-2.5 border-b border-border/60">
        <div className="flex flex-1 min-w-0 flex-col gap-1">
          {/* host:port */}
          <span className="font-mono text-[12.5px] font-semibold text-foreground/90 truncate leading-tight">
            {row.host}:{row.port}
          </span>
          {/* cluster name */}
          {row.zookeeper_cluster_name && (
            <span className="text-[10.5px] text-muted-foreground truncate leading-snug">
              {row.zookeeper_cluster_name}
            </span>
          )}
        </div>

        {/* Badges + connection dot */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <RoleBadge role={role} />
          <KeeperTypeBadge version={row.version} />
          {/* Connection status dot */}
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'inline-flex items-center justify-center size-4 rounded-full cursor-default',
                    connected
                      ? 'bg-emerald-100 dark:bg-emerald-900/30'
                      : 'bg-rose-100 dark:bg-rose-900/30'
                  )}
                />
              }
            >
              {connected ? (
                <Wifi
                  className="size-2.5 text-emerald-600 dark:text-emerald-400"
                  aria-label="Connected"
                />
              ) : (
                <WifiOff
                  className="size-2.5 text-rose-600 dark:text-rose-400"
                  aria-label="Disconnected"
                />
              )}
            </TooltipTrigger>
            <TooltipContent side="top">
              {connected ? 'Connected' : 'Disconnected'}
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      {/* Metrics grid */}
      <CardContent className="p-3 pt-2.5 flex flex-col gap-1">
        {/* Latency */}
        <div className="mb-1">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
            Latency
          </span>
          <div className="mt-0.5 grid grid-cols-3 gap-1">
            <MetricRow label="avg" value={fmtMs(row.avg_latency)} />
            <MetricRow label="min" value={fmtMs(row.min_latency)} />
            <MetricRow label="max" value={fmtMs(row.max_latency)} />
          </div>
        </div>

        {/* Znodes / watches / ephemerals / data */}
        <div className="mb-1">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
            Storage
          </span>
          <div className="mt-0.5 flex flex-col gap-0.5">
            <MetricRow label="Znodes" value={fmtCount(row.znode_count)} />
            <MetricRow label="Watches" value={fmtCount(row.watch_count)} />
            <MetricRow
              label="Ephemerals"
              value={fmtCount(row.ephemerals_count)}
            />
            <MetricRow
              label="Data size"
              value={row.readable_approximate_data_size || '—'}
            />
          </div>
        </div>

        {/* Network */}
        <div className="mb-1">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
            Network
          </span>
          <div className="mt-0.5 flex flex-col gap-0.5">
            <MetricRow
              label="Packets sent"
              value={fmtCount(row.packets_sent)}
            />
            <MetricRow
              label="Packets recv"
              value={fmtCount(row.packets_received)}
            />
            <MetricRow
              label="Outstanding"
              value={fmtCount(row.outstanding_requests)}
            />
          </div>
        </div>

        {/* Raft (only meaningful when not standalone) */}
        {!isStandalone && (
          <div>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
              Raft
            </span>
            <div className="mt-0.5 flex flex-col gap-0.5">
              <MetricRow
                label="Log lag"
                value={raftLag.toLocaleString()}
                className={cn(
                  raftLag > 1000 && 'text-rose-600 dark:text-rose-400'
                )}
              />
              <MetricRow label="Zxid" value={fmtCount(row.zxid)} />
              {num(row.followers) > 0 && (
                <MetricRow
                  label="Followers"
                  value={`${fmtCount(row.synced_followers)}/${fmtCount(row.followers)} synced`}
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function NodeCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-32 rounded" />
        <div className="ml-auto flex gap-1.5">
          <Skeleton className="h-4 w-14 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>
      <Skeleton className="h-3 w-20 rounded" />
      <div className="mt-1 flex flex-col gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-2.5 rounded" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function KeeperNodeCards() {
  const hostId = useHostId()
  const { data, error, isLoading } = useTableData<KeeperInfoRow>(
    'keeper-info',
    hostId
  )

  // Group rows by cluster name. Memoized so the Map is only rebuilt when
  // `data` changes — not on every parent re-render (e.g. polling ticks that
  // return the same reference, tooltip hovers, or sibling state updates).
  const { clusters, multiCluster } = useMemo(() => {
    const map = new Map<string, KeeperInfoRow[]>()
    for (const row of data ?? []) {
      const name = row.zookeeper_cluster_name ?? ''
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(row)
    }
    return { clusters: map, multiCluster: map.size > 1 }
  }, [data])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NodeCardSkeleton />
        <NodeCardSkeleton />
        <NodeCardSkeleton />
      </div>
    )
  }

  if (error) {
    const msg = (error as Error)?.message ?? String(error)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-300">
        <ServerCrash className="size-4 shrink-0" />
        <span>Failed to load keeper nodes: {msg}</span>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">
        <Database className="size-8 opacity-30" />
        <p className="text-[12.5px]">
          No keeper nodes found.
          <br />
          <span className="text-[11.5px] opacity-70">
            system.zookeeper_info requires ClickHouse ≥ 26.1 and an active
            Keeper / ZooKeeper connection.
          </span>
        </p>
      </div>
    )
  }

  return (
    <TooltipProvider delay={300}>
      <div className="flex flex-col gap-4">
        {Array.from(clusters.entries()).map(([clusterName, nodes]) => (
          <div key={clusterName} className="flex flex-col gap-2">
            {multiCluster && (
              <div className="flex items-center gap-2">
                <Layers className="size-3.5 text-muted-foreground" />
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {clusterName || 'default'}
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  ({nodes.length} {nodes.length === 1 ? 'node' : 'nodes'})
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nodes.map((row) => (
                <NodeCard key={`${row.host}:${row.port}`} row={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}

export default KeeperNodeCards
