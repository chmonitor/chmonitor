import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import {
  ChartSkeleton,
  PageSkeleton,
  TableSkeleton,
} from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/empty-state'
import {
  UserUsageKpis,
  UserUsageProfile,
} from '@/components/usage/user-usage-header'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import {
  USER_DAILY_MAX_DAYS,
  USER_USAGE_DAY_OPTIONS,
  userUsageConfigs,
  userUsageDailyConfig,
} from '@/lib/query-config/queries/user-usage'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'
import {
  ChartQueryCountHeatmap,
  ChartQueryHourHeatmap,
} from '@/routes/(dashboard)/-charts-lazy'

const TITLES: Record<string, string> = {
  'user-usage-daily': 'Daily Activity',
  'user-usage-hours': 'Weekday x Hour',
  'user-usage-tables': 'Top Tables',
  'user-usage-shapes': 'Top Query Shapes',
  'user-usage-kinds': 'Query Kinds',
  'user-usage-interfaces': 'Interfaces',
  'user-usage-errors': 'Errors',
  'user-usage-clients': 'Clients',
}

function UserUsageContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const user = searchParams.get('user') ?? ''
  const days =
    searchParams.get('days') ??
    String(userUsageDailyConfig.defaultParams?.days ?? '7')

  const usageUrl = `/usage?host=${hostId}`

  if (!user) {
    return (
      <EmptyState
        variant="no-data"
        title="No user selected"
        description={
          <>
            Pick a user from the{' '}
            <Link
              href={usageUrl}
              className="text-primary underline underline-offset-2"
            >
              usage list
            </Link>
            .
          </>
        }
      />
    )
  }

  const userParam = encodeURIComponent(user)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Usage: {user}</h1>
        <div className="ml-auto flex items-center gap-1 text-sm">
          {USER_USAGE_DAY_OPTIONS.map((d) => (
            <Link
              key={d}
              href={`/usage/user?user=${userParam}&days=${d}&host=${hostId}`}
              className={cn(
                'rounded-md px-2 py-1',
                d === days
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d === String(USER_DAILY_MAX_DAYS) ? '1y' : `${d}d`}
            </Link>
          ))}
        </div>
      </div>
      <UserUsageProfile user={user} />
      <UserUsageKpis user={user} days={days} />
      <p className="text-muted-foreground text-xs">
        The activity calendar always shows the last year and Daily Activity
        follows the window up to a year; every other total and table covers at
        most 30 days.
      </p>
      <Suspense fallback={<ChartSkeleton />}>
        <ChartQueryCountHeatmap
          title="Activity Calendar"
          lastHours={24 * USER_DAILY_MAX_DAYS}
          params={{ user }}
        />
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <ChartQueryHourHeatmap
          title="Hour Heatmap"
          lastHours={Number(days) * 24}
          params={{ user }}
        />
      </Suspense>
      {userUsageConfigs.map((config) => (
        <Suspense key={config.name} fallback={<TableSkeleton />}>
          <TableClient
            title={TITLES[config.name] ?? config.name}
            description={config.description}
            queryConfig={config}
            searchParams={{ user, days }}
          />
        </Suspense>
      ))}
    </div>
  )
}

function UserUsagePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UserUsageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/usage/user')({
  component: UserUsagePage,
  head: () => pageOgHead('usage/user'),
})
