import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'

export const OverviewStatusStrip = function OverviewStatusStrip({
  className,
}: {
  className?: string
}) {
  const hostId = useHostId()
  // Shares the `useHostStatus` query key with ClickHouseInfoCard — keep the
  // refresh interval identical so queries dedupe to a single 5-minute poll
  // (host version / uptime / hostname are near-static).
  const { data, error, isLoading } = useHostStatus(hostId, {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  let dot: string
  let pulse = false
  let label: string

  if (isLoading && !data) {
    dot = 'bg-muted-foreground/50'
    label = 'Connecting to cluster…'
  } else if (error && !data) {
    dot = 'bg-amber-500'
    label = 'Cluster status unavailable'
  } else if (error) {
    dot = 'bg-amber-500'
    label = 'Cluster online · status check delayed'
  } else {
    dot = 'bg-emerald-500'
    pulse = true
    label = 'Cluster online'
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[12.5px] text-muted-foreground',
        className
      )}
      role="status"
    >
      <span className="relative inline-flex size-2 shrink-0">
        {pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              dot
            )}
          />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', dot)} />
      </span>
      <span className="font-medium text-foreground">{label}</span>
      {data?.hostname && (
        <span className="hidden truncate sm:inline">
          · <span className="font-mono">{data.hostname}</span>
        </span>
      )}
      {data?.version && (
        <span className="hidden truncate md:inline">
          · ClickHouse <span className="font-mono">v{data.version}</span>
        </span>
      )}
    </div>
  )
}
