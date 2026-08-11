import { FleetHostCard } from './fleet-host-card'
import { FleetSummaryStrip } from './fleet-summary'
import { Skeleton } from '@/components/ui/skeleton'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

function FleetSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-72 w-full rounded-xl" />
      ))}
    </div>
  )
}

/**
 * Renders a responsive grid of FleetHostCard — one card per host from
 * the merged host list (env + browser + database connections).
 */
export function FleetOverview() {
  const { hosts, isLoading } = useMergedHosts()

  if (isLoading) {
    return <FleetSkeleton />
  }

  if (hosts.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">
          No hosts configured. Add a ClickHouse connection to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <FleetSummaryStrip hosts={hosts} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {hosts.map((host) => (
          <FleetHostCard key={`${host.source}-${host.id}`} host={host} />
        ))}
      </div>
    </div>
  )
}
