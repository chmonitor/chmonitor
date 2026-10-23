import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import { dashboardUsageConfigs } from '@/lib/query-config/queries/dashboard-usage'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

const TITLES: Record<string, string> = {
  'dashboard-usage-daily': 'Over Time',
  'dashboard-usage-by-user': 'By User',
  'dashboard-usage-by-source': 'By Source',
  'dashboard-usage-by-version': 'By Version',
  'dashboard-usage-by-label': 'By Deployment Label',
  'dashboard-usage-expensive': 'Most Expensive Queries',
}

const DAY_OPTIONS = ['1', '7', '30']

function DashboardUsageContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const days = searchParams.get('days') ?? '7'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Dashboard usage</h1>
        <div className="ml-auto flex items-center gap-1 text-sm">
          {DAY_OPTIONS.map((d) => (
            <Link
              key={d}
              href={`/dashboard-usage?days=${d}&host=${hostId}`}
              className={cn(
                'rounded-md px-2 py-1',
                d === days
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Queries this dashboard sent to ClickHouse, read from the attribution
        record on each query in system.query_log. Turn it off with
        CHM_QUERY_ATTRIBUTION=false. Signed-in users appear only with an auth
        provider.
      </p>
      {dashboardUsageConfigs.map((config) => (
        <Suspense key={config.name} fallback={<TableSkeleton />}>
          <TableClient
            title={TITLES[config.name] ?? config.name}
            description={config.description}
            queryConfig={config}
            searchParams={{ days }}
          />
        </Suspense>
      ))}
    </div>
  )
}

function DashboardUsagePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardUsageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/dashboard-usage')({
  component: DashboardUsagePage,
  head: () => pageOgHead('dashboard-usage'),
})
