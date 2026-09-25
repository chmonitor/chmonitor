import type { ReactNode } from 'react'

interface HeaderActionRegionProps {
  children: ReactNode
}

/**
 * The right side of the dashboard header. It owns the responsive boundary:
 * phones get a full-width second row that can be swiped, while sm+ keeps the
 * controls in the remaining column and right-aligns them. The identity cluster
 * is never allowed to become the shrinking flex item.
 */
export function HeaderActionRegion({ children }: HeaderActionRegionProps) {
  return (
    <div
      data-testid="dashboard-header-actions"
      className="scrollbar-hide ml-auto flex w-full min-w-0 max-w-full basis-full shrink-0 justify-end overflow-x-auto px-3 pb-2 sm:w-auto sm:flex-1 sm:shrink sm:px-4 sm:pb-0"
    >
      {children}
    </div>
  )
}
