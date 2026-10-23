import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DashboardUsageOverview,
  DashboardUserEmail,
  DaySelector,
  parseUsageDays,
} from '@/components/usage/dashboard-usage-overview'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import {
  dashboardUsageErrorsConfig,
  dashboardUsageExpensiveConfig,
  dashboardUsageRecentConfig,
} from '@/lib/query-config/queries/dashboard-usage'
import { useHostId } from '@/lib/swr'

const TABLES = [
  { config: dashboardUsageRecentConfig, title: 'Recent Queries' },
  { config: dashboardUsageErrorsConfig, title: 'Errors' },
  { config: dashboardUsageExpensiveConfig, title: 'Most Expensive Queries' },
]

const DIMENSIONS = ['source', 'page'] as const

function DashboardUserContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const user = searchParams.get('user') ?? ''
  const days = parseUsageDays(searchParams.get('days'))
  const listUrl = `/dashboard-usage?days=${days}&host=${hostId}`

  if (!user) {
    return (
      <EmptyState
        variant="no-data"
        title="No dashboard user selected"
        description={
          <>
            Pick a user in By User on{' '}
            <Link
              href={listUrl}
              className="text-primary underline underline-offset-2"
            >
              Dashboard Usage
            </Link>
            . Anonymous and cron queries carry no user name, so they have no
            detail view.
          </>
        }
      />
    )
  }

  const userParam = encodeURIComponent(user)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={listUrl}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Dashboard usage
        </Link>
        <span className="text-muted-foreground text-sm">/</span>
        <h1 className="text-lg font-semibold">{user}</h1>
        <DashboardUserEmail user={user} days={days} />
        <DaySelector
          days={days}
          href={(d) =>
            `/dashboard-usage/user?user=${userParam}&days=${d}&host=${hostId}`
          }
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Queries this dashboard sent for one signed-in user, from the attribution
        record in system.query_log on this replica. This is the dashboard user,
        not the ClickHouse account that ran the query.
      </p>
      <DashboardUsageOverview user={user} days={days} dimensions={DIMENSIONS} />
      {TABLES.map(({ config, title }) => (
        <Suspense key={config.name} fallback={<TableSkeleton />}>
          <TableClient
            title={title}
            description={config.description}
            queryConfig={config}
            searchParams={{ days, dashboard_user: user }}
          />
        </Suspense>
      ))}
    </div>
  )
}

function DashboardUserPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardUserContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/dashboard-usage/user')({
  component: DashboardUserPage,
  head: () => pageOgHead('dashboard-usage/user'),
})
