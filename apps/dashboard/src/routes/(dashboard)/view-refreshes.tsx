import { createFileRoute } from '@tanstack/react-router'

import { MvStalenessBadge } from '@/components/alerting/mv-staleness-badge'
import { QueryPageLayout } from '@/components/layout/query-page'
import { TooltipProvider } from '@/components/ui/tooltip'
import { pageOgHead } from '@/lib/og'
import { viewRefreshesConfig } from '@/lib/query-config/tables/view-refreshes'
import { useHostId } from '@/lib/swr/use-host'

/**
 * View Refreshes page — standard query layout with an MV staleness badge
 * prepended above the table so failed/stale views are immediately visible.
 */
function ViewRefreshesPage() {
  const hostId = useHostId()

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3 sm:gap-4">
        <MvStalenessBadge hostId={hostId} />
        <QueryPageLayout
          queryConfig={viewRefreshesConfig}
          title="View Refreshes"
        />
      </div>
    </TooltipProvider>
  )
}

export const Route = createFileRoute('/(dashboard)/view-refreshes')({
  component: ViewRefreshesPage,
  head: () => pageOgHead('view-refreshes'),
})
