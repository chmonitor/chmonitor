import { Suspense } from 'react'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The left side of the dashboard header: sidebar access and the current page
 * identity. It is intentionally intrinsic-width so a crowded action region can
 * never turn the breadcrumb into an ellipsized flex leftover. Below `sm` it
 * fills row 1 so the utility icons (from HeaderActionRegion's `contents`
 * children) sit right-aligned beside it; the header owns the phone gutter.
 */
export function HeaderIdentity() {
  return (
    <div
      data-testid="dashboard-header-identity"
      className="flex shrink-0 items-center gap-2 max-sm:flex-1 sm:px-4"
    >
      <SidebarTrigger className="-ml-1 size-11 lg:size-7" />
      <Separator
        orientation="vertical"
        className="data-vertical:h-4 data-vertical:self-center"
      />
      <Suspense fallback={<Skeleton className="h-4 w-32" />}>
        <Breadcrumb />
      </Suspense>
    </div>
  )
}
