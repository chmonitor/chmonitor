/**
 * Tabs skeleton component for loading states
 */

import { Skeleton } from './base'
import { cn } from '@/lib/utils'

interface TabsSkeletonProps {
  tabCount?: number
  className?: string
  /**
   * "pill"      — default shadcn pill tabs (h-9 rounded bg-muted container)
   * "underline" — flat border-bottom style used by the overview page tabs
   *               (no background, no rounded corners, matches the real TabsList
   *               geometry to prevent CLS on hydration)
   */
  variant?: 'pill' | 'underline'
}

export function TabsSkeleton({
  tabCount = 5,
  className,
  variant = 'pill',
}: TabsSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Tabs list skeleton */}
      {variant === 'underline' ? (
        <div className="scrollbar-hide min-w-0 w-full overflow-x-auto py-0.5">
          <div className="inline-flex h-auto w-max min-w-full flex-nowrap items-center justify-start gap-1 border-b border-border bg-transparent p-0">
            {Array.from({ length: tabCount }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-9 w-20 rounded-none border-b-2 border-transparent bg-transparent"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1 -mx-1 px-1 sm:mx-0 sm:px-0">
          <div className="bg-muted inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px] gap-1">
            {Array.from({ length: tabCount }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-md" />
            ))}
          </div>
        </div>
      )}
      {/* Tab content skeleton */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
