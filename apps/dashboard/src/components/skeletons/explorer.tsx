import { Skeleton } from './base'
import { cn } from '@/lib/utils'

/**
 * Structured skeleton for the database explorer.
 *
 * Mirrors the explorer layout (tree sidebar + content area) so the loading
 * state matches the real UI and avoids a featureless grey slab / CLS.
 *
 * @see components/explorer/explorer-layout.tsx
 */
export function ExplorerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex h-full', className)}
      role="status"
      aria-label="Loading explorer"
      aria-busy="true"
    >
      {/* Tree sidebar - matches ExplorerSidebar width */}
      <div className="w-64 shrink-0 space-y-1 overflow-hidden border-r p-3 md:w-72 lg:w-80">
        {/* Search / filter input */}
        <Skeleton className="mb-3 h-9 w-full" />
        {/* Database / table tree nodes */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={`tree-node-${i}`}
            className="flex items-center gap-2 py-1.5"
            style={{
              paddingLeft: i % 3 === 0 ? '0.25rem' : '1.25rem',
            }}
          >
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton
              className="h-4"
              style={{ width: `${55 + ((i * 13) % 35)}%` }}
            />
          </div>
        ))}
      </div>

      {/* Content area - matches ExplorerContent (breadcrumb + tabs + table) */}
      <div className="flex-1 space-y-4 overflow-hidden p-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="size-3" />
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-2 border-b pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`tab-${i}`} className="h-8 w-20" />
          ))}
        </div>

        {/* Content table */}
        <div className="overflow-hidden rounded-md border">
          {/* Table header */}
          <div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={`content-header-${i}`} className="h-4 flex-1" />
            ))}
          </div>
          {/* Table rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`content-row-${i}`}
              className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={`content-cell-${j}`} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading database explorer…</span>
    </div>
  )
}
