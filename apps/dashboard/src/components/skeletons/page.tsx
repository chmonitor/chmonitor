import { ChartSkeleton } from '@/components/skeletons/chart'
import { TableSkeleton } from '@/components/skeletons/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const PageSkeleton = function PageSkeleton({
  chartCount = 4,
  tableRows = 5,
  className,
}: {
  chartCount?: number
  tableRows?: number
  className?: string
} = {}) {
  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading page content"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: chartCount }).map((_, i) => (
          <ChartSkeleton key={`chart-${i}`} />
        ))}
      </div>

      <TableSkeleton rows={tableRows} />
    </div>
  )
}

export const ChartsOnlyPageSkeleton = function ChartsOnlyPageSkeleton({
  chartCount = 6,
  className,
}: {
  chartCount?: number
  className?: string
} = {}) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-3 md:grid-cols-2', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading charts"
    >
      {Array.from({ length: chartCount }).map((_, i) => (
        <ChartSkeleton key={`chart-${i}`} />
      ))}
    </div>
  )
}

export const TableOnlyPageSkeleton = function TableOnlyPageSkeleton({
  rows = 10,
  className,
}: {
  rows?: number
  className?: string
} = {}) {
  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading table"
    >
      <TableSkeleton rows={rows} />
    </div>
  )
}

/**
 * Agents Page Skeleton
 *
 * Reserves the exact footprint of the lazy-mounted `AgentThreadPage` so the
 * chat composer + settings sidebar don't shift content when they mount after
 * first paint (CLS). Mirrors that component's outer container
 * (`h-[calc(100dvh-6rem)] rounded-xl border`), a main column with a bottom
 * composer strip, and the 320px settings sidebar (open by default on desktop).
 */
export const AgentsPageSkeleton = function AgentsPageSkeleton({
  className,
}: {
  className?: string
} = {}) {
  return (
    <div
      className={cn(
        'bg-background flex h-[calc(100dvh-6rem)] min-h-0 overflow-hidden rounded-xl border',
        className
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading agent"
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Skeleton className="absolute top-3 left-3 h-8 w-32 rounded-md" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="border-t p-4">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>

      <div className="hidden w-[320px] shrink-0 border-l p-4 md:block">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={`agent-sidebar-row-${i}`} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
