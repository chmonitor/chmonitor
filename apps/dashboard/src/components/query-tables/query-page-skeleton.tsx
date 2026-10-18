import { Skeleton } from '@/components/skeletons'

export function QueryPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="ml-auto h-4 w-16" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border p-3"
        >
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * Running-queries page skeleton — reserves space for the full page layout
 * (header + chart strip + running table + completed table) so the Suspense
 * fallback matches the final rendered height and avoids a CLS flash.
 */
export function RunningQueriesPageSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-busy="true"
      aria-label="Loading running queries"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="mt-1 h-4 w-72" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={`chart-${i}`}
            className="h-[160px] w-full rounded-xl"
          />
        ))}
      </div>

      <QueryPageSkeleton rows={5} />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={`completed-${i}`}
            className="flex items-center gap-3 border-b border-border p-3"
          >
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
