import { Skeleton } from './base'

export function SidebarSkeleton() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-64 border-r bg-sidebar p-4 md:block">
        <Skeleton className="mb-4 h-8 w-32" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      </div>
    </div>
  )
}
