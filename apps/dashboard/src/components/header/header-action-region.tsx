import type { ReactNode } from 'react'

interface HeaderActionRegionProps {
  children: ReactNode
}

/**
 * The right side of the dashboard header. It owns the responsive boundary:
 * below `sm` it is `display: contents`, so the utility icons join the title
 * row and the time-range picker wraps to its own full-width row; sm+ keeps the
 * controls in the remaining column, right-aligned and swipeable. The identity cluster
 * is never allowed to become the shrinking flex item.
 */
export function HeaderActionRegion({ children }: HeaderActionRegionProps) {
  return (
    <div
      data-testid="dashboard-header-actions"
      className="scrollbar-hide contents sm:ml-auto sm:flex sm:w-auto sm:min-w-0 sm:max-w-full sm:flex-1 sm:shrink sm:justify-end sm:overflow-x-auto sm:px-4"
    >
      {children}
    </div>
  )
}
