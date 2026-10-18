import { Skeleton } from '@/components/ui/skeleton'

export function PeerDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-48 rounded" />
      </div>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3 flex gap-4">
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/12" />
            <Skeleton className="h-4 w-1/12" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
          </div>
          <div className="p-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-4 w-1/12" />
                <Skeleton className="h-4 w-1/12" />
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3 flex gap-4">
            <Skeleton className="h-4 w-1/12" />
            <Skeleton className="h-4 w-1/12" />
            <Skeleton className="h-4 w-1/12" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="p-4 flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-1/12" />
                <Skeleton className="h-4 w-1/12" />
                <Skeleton className="h-4 w-1/12" />
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
