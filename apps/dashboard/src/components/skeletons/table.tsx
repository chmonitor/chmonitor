import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Table skeleton with configurable rows and columns
 * Matches DataTable layout to prevent CLS
 */
export const TableSkeleton = function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-1 flex-col', className)}
      role="status"
      aria-label="Loading table"
      aria-busy="true"
    >
      {/* Table header area - matches DataTable */}
      <div className="flex shrink-0 flex-row items-start justify-between pb-4">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-48" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* Table body - matches DataTable border container */}
      <div className="mb-5 flex-1 overflow-hidden rounded-md border">
        <div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={`header-${j}`} className="h-4 flex-1" />
          ))}
        </div>
        <div className="flex flex-col">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={`row-${i}`}
              className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              {Array.from({ length: cols }).map((_, j) => (
                <Skeleton key={`col-${j}`} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading table data…</span>
    </div>
  )
}
