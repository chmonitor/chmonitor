import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const SingleLineSkeleton = function SingleLineSkeleton({
  className = 'w-[500px]',
}: {
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-row items-center gap-2 space-x-4 pt-5',
        className
      )}
      role="status"
      aria-label="Loading content"
      aria-busy="true"
    >
      <Skeleton className="h-6 w-3/5" />
      <Skeleton className="h-6 w-2/5" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export const MultiLineSkeleton = function MultiLineSkeleton({
  className = 'w-[500px]',
}: {
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      role="status"
      aria-label="Loading content"
      aria-busy="true"
    >
      <div className="flex w-full flex-row items-center gap-2">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-6 w-2/5" />
      </div>
      <div className="flex w-full flex-row items-center gap-2">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-6 w-1/5" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export const ListSkeleton = function ListSkeleton({
  nrows = 4,
  className = 'w-[500px]',
}: {
  nrows?: number
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      role="status"
      aria-label="Loading list"
      aria-busy="true"
    >
      {Array.from({ length: nrows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
      <span className="sr-only">Loading list items…</span>
    </div>
  )
}
