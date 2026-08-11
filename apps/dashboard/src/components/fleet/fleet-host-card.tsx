import { useNavigate } from '@tanstack/react-router'

import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

import { formatCount, formatPercent, safeRatio } from './fleet-helpers'
import { FleetSparkline } from './fleet-sparkline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatReadableSize } from '@/lib/format-readable'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'

interface FleetHostCardProps {
  host: MergedHostInfo
}

/** Individual host card for the /fleet overview page. */
export function FleetHostCard({ host }: FleetHostCardProps) {
  const navigate = useNavigate()
  // Browser connections (negative IDs) have no server-side status endpoint.
  const isBrowser = host.id < 0
  const {
    data: status,
    isLoading,
    isOnline,
  } = useHostStatus(isBrowser ? null : host.id, { fleet: true })

  const diskRatio = safeRatio(status?.diskUsedBytes, status?.diskTotalBytes)
  const memRatio = safeRatio(status?.memoryBytes, status?.memoryTotalBytes)

  const handleView = () => {
    navigate({
      to: '/overview',
      search: (prev) => ({ ...prev, host: host.id }),
    })
  }

  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2 text-base leading-snug">
            {host.name || host.host}
          </CardTitle>
          {isBrowser ? (
            <Badge variant="outline" className="shrink-0 text-xs">
              browser
            </Badge>
          ) : isLoading ? (
            <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
          ) : isOnline ? (
            <Badge
              variant="outline"
              className="shrink-0 border-green-500/40 bg-green-500/10 text-xs text-green-700 dark:text-green-400"
            >
              online
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="shrink-0 border-red-500/40 bg-red-500/10 text-xs text-red-700 dark:text-red-400"
            >
              offline
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{host.host}</p>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        {isBrowser ? (
          <p className="text-xs text-muted-foreground">
            Browser-stored connection — status not available.
          </p>
        ) : isLoading ? (
          <div className="space-y-1.5">
            {/* Matches the metric list height below to avoid layout shift. */}
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
            <Skeleton className="h-5 w-full" />
          </div>
        ) : status ? (
          <div className="space-y-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="truncate font-mono">{status.version}</dd>
              <dt className="text-muted-foreground">Uptime</dt>
              <dd className="truncate">{status.uptime}</dd>
              <dt className="text-muted-foreground">Hostname</dt>
              <dd className="truncate text-muted-foreground">
                {status.hostname}
              </dd>
              <dt className="text-muted-foreground">Running</dt>
              <dd className="truncate tabular-nums">
                {formatCount(status.runningQueries)}
              </dd>
              <dt className="text-muted-foreground">Memory</dt>
              <dd className="truncate tabular-nums">
                {status.memoryBytes === undefined
                  ? '—'
                  : formatReadableSize(status.memoryBytes)}
                {memRatio === undefined ? null : (
                  <span className="text-muted-foreground">
                    {' '}
                    ({formatPercent(memRatio)})
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">Disk used</dt>
              <dd className="truncate tabular-nums">
                {formatPercent(diskRatio)}
                {status.diskTotalBytes === undefined ? null : (
                  <span className="text-muted-foreground">
                    {' '}
                    of {formatReadableSize(status.diskTotalBytes)}
                  </span>
                )}
              </dd>
              {status.replicationDelay === undefined ? null : (
                <>
                  <dt className="text-muted-foreground">Replica lag</dt>
                  <dd className="truncate tabular-nums">
                    {formatCount(status.replicationDelay)}s
                    {status.readonlyReplicas ? (
                      <span className="text-amber-600 dark:text-amber-500">
                        {' '}
                        · {formatCount(status.readonlyReplicas)} read-only
                      </span>
                    ) : null}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Errors (1h)</dt>
              <dd
                className={cn(
                  'truncate tabular-nums',
                  status.recentErrors
                    ? 'text-amber-600 dark:text-amber-500'
                    : undefined
                )}
              >
                {formatCount(status.recentErrors)}
              </dd>
            </dl>
            <FleetSparkline
              values={status.series}
              label="Running queries over the last hour"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Unable to reach host.</p>
        )}
      </CardContent>

      <CardFooter className="pt-0">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={handleView}
        >
          View
        </Button>
      </CardFooter>
    </Card>
  )
}
