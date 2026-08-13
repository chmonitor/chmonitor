import { useNavigate } from '@tanstack/react-router'

import type { PgConnectionInfo } from '@/lib/hooks/use-pg-connections'
import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

import { formatCount, formatPercent, safeRatio } from './fleet-helpers'
import { FleetSummaryStrip } from './fleet-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatReadableSize } from '@/lib/format-readable'
import { usePgConnections } from '@/lib/hooks/use-pg-connections'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { splitHref } from '@/lib/url/url-builder'
import { cn, getHost } from '@/lib/utils'

/** Number of metric columns between "Host" and the trailing action column. */
const METRIC_COLSPAN = 11

/** Small status dot — green (online), red (offline), muted (unknown). */
function StatusDot({
  state,
}: {
  state: 'online' | 'offline' | 'unknown' | 'loading'
}) {
  if (state === 'loading') {
    return (
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-muted-foreground/40" />
    )
  }
  const color =
    state === 'online'
      ? 'bg-green-500'
      : state === 'offline'
        ? 'bg-red-500'
        : 'bg-muted-foreground/40'
  return <span className={cn('size-2 shrink-0 rounded-full', color)} />
}

/** Source/engine badge for the Host cell — omitted for plain self-hosted env. */
function SourceBadge({ source }: { source: MergedHostInfo['source'] }) {
  if (source === 'env') return null
  const label =
    source === 'demo' ? 'demo' : source === 'database' ? 'saved' : 'browser'
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      {label}
    </Badge>
  )
}

/**
 * One table row per ClickHouse host. Calls `useHostStatus` itself (hooks at the
 * deepest consumer) so each host's metrics load independently — a slow host
 * never blocks the rest of the table.
 */
function FleetTableRow({ host }: { host: MergedHostInfo }) {
  const navigate = useNavigate()
  // Browser connections (negative IDs) have no server-side status endpoint.
  const isBrowser = host.id < 0
  const {
    data: status,
    isLoading,
    isOnline,
  } = useHostStatus(isBrowser ? null : host.id, { fleet: true })

  const diskRatio = safeRatio(status?.diskUsedBytes, status?.diskTotalBytes)

  const handleView = () => {
    navigate({
      to: '/overview',
      search: (prev) => ({ ...prev, host: host.id }),
    })
  }

  const hostLabel = host.name || getHost(host.host)
  const dotState: 'online' | 'offline' | 'unknown' | 'loading' = isBrowser
    ? 'unknown'
    : isLoading
      ? 'loading'
      : isOnline
        ? 'online'
        : 'offline'

  return (
    <TableRow
      className="cursor-pointer"
      onClick={handleView}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleView()
        }
      }}
    >
      <TableCell className="max-w-56">
        <div className="flex items-center gap-2">
          <StatusDot state={dotState} />
          <span className="truncate font-medium">{hostLabel}</span>
          <SourceBadge source={host.source} />
        </div>
        <span className="block truncate text-xs text-muted-foreground">
          {host.host}
        </span>
      </TableCell>

      {isBrowser ? (
        <TableCell
          colSpan={METRIC_COLSPAN}
          className="text-xs text-muted-foreground"
        >
          Browser-stored connection — status not available.
        </TableCell>
      ) : isLoading ? (
        <>
          <MetricSkeletonCell />
          <MetricSkeletonCell />
          <MetricSkeletonCell />
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricSkeletonCell key={i} className="text-right" />
          ))}
        </>
      ) : status ? (
        <>
          <TableCell className="font-mono text-xs">
            {status.version || '—'}
          </TableCell>
          <TableCell className="text-xs">{status.uptime || '—'}</TableCell>
          <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
            {status.hostname || '—'}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCount(status.databases)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCount(status.tables)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCount(status.clusterNodes)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCount(status.runningQueries)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {status.memoryBytes === undefined
              ? '—'
              : formatReadableSize(status.memoryBytes)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatPercent(diskRatio)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {status.replicationDelay === undefined
              ? '—'
              : `${formatCount(status.replicationDelay)}s`}
            {status.readonlyReplicas ? (
              <span className="text-amber-600 dark:text-amber-500">
                {' '}
                · {formatCount(status.readonlyReplicas)} ro
              </span>
            ) : null}
          </TableCell>
          <TableCell
            className={cn(
              'text-right tabular-nums',
              status.recentErrors && 'text-amber-600 dark:text-amber-500'
            )}
          >
            {formatCount(status.recentErrors)}
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="text-muted-foreground">—</TableCell>
          <TableCell className="text-muted-foreground">—</TableCell>
          <TableCell className="text-muted-foreground">—</TableCell>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableCell key={i} className="text-right text-muted-foreground">
              —
            </TableCell>
          ))}
        </>
      )}

      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={(e) => {
            e.stopPropagation()
            handleView()
          }}
        >
          View
        </Button>
      </TableCell>
    </TableRow>
  )
}

function MetricSkeletonCell({ className }: { className?: string }) {
  return (
    <TableCell className={className}>
      <Skeleton
        className={cn(
          'h-4 w-16',
          className?.includes('text-right') && 'ml-auto'
        )}
      />
    </TableCell>
  )
}

/** Static row for a Postgres source — no ClickHouse status hook applies. */
function FleetPgRow({ pg }: { pg: PgConnectionInfo }) {
  const navigate = useNavigate()
  const handleView = () => {
    navigate(
      splitHref(`/postgres/queries?pg=${encodeURIComponent(pg.connectionId)}`)
    )
  }
  return (
    <TableRow
      className="cursor-pointer"
      onClick={handleView}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleView()
        }
      }}
    >
      <TableCell className="max-w-56">
        <div className="flex items-center gap-2">
          <StatusDot state="unknown" />
          <span className="truncate font-medium">{pg.name || pg.host}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Postgres
          </Badge>
        </div>
        <span className="block truncate text-xs text-muted-foreground">
          {pg.host}
        </span>
      </TableCell>
      <TableCell
        colSpan={METRIC_COLSPAN}
        className="text-xs text-muted-foreground"
      >
        Postgres source — ClickHouse metrics not applicable.
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={(e) => {
            e.stopPropagation()
            handleView()
          }}
        >
          View
        </Button>
      </TableCell>
    </TableRow>
  )
}

function FleetTableSkeleton() {
  return (
    <div className="rounded-lg border">
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * Cross-host comparison matrix — one row per host, each metric cell loading
 * asynchronously per host. Companion to the card grid (`FleetOverview`); the
 * two share the same host list and TanStack Query cache.
 */
export function FleetTable() {
  const { hosts, isLoading } = useMergedHosts()
  const { connections: pgConnections } = usePgConnections()

  if (isLoading) {
    return <FleetTableSkeleton />
  }

  if (hosts.length === 0 && pgConnections.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">
          No hosts configured. Add a connection to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <FleetSummaryStrip hosts={hosts} />
      {/* The metric matrix is intentionally wide — scroll it rather than
          dropping columns. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Host</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead>Hostname</TableHead>
              <TableHead className="text-right">Databases</TableHead>
              <TableHead className="text-right">Tables</TableHead>
              <TableHead className="text-right">Cluster</TableHead>
              <TableHead className="text-right">Running</TableHead>
              <TableHead className="text-right">Memory</TableHead>
              <TableHead className="text-right">Disk used</TableHead>
              <TableHead className="text-right">Replica lag</TableHead>
              <TableHead className="text-right">Errors (1h)</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.map((host) => (
              <FleetTableRow key={`${host.source}-${host.id}`} host={host} />
            ))}
            {pgConnections.map((pg) => (
              <FleetPgRow key={`pg-${pg.connectionId}`} pg={pg} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
