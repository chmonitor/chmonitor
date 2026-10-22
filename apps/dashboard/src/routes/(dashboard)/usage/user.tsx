import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/empty-state'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import {
  USER_DAILY_MAX_DAYS,
  userUsageConfigs,
  userUsageDailyConfig,
} from '@/lib/query-config/queries/user-usage'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

const TITLES: Record<string, string> = {
  'user-usage-daily': 'Daily Activity',
  'user-usage-hours': 'Weekday x Hour',
  'user-usage-tables': 'Top Tables',
  'user-usage-shapes': 'Top Query Shapes',
  'user-usage-errors': 'Errors',
  'user-usage-clients': 'Clients',
}

const DAY_OPTIONS = ['7', '30', String(USER_DAILY_MAX_DAYS)]

function UserUsageContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const user = searchParams.get('user') ?? ''
  const days =
    searchParams.get('days') ?? userUsageDailyConfig.defaultParams?.days ?? '7'

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
          {DAY_OPTIONS.map((d) => (
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
      <p className="text-muted-foreground text-xs">
        Tables other than Daily Activity cover at most 30 days.
      </p>
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
