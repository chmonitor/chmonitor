import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { KpiTile } from '@/components/usage/kpi-tiles'

import { Suspense } from 'react'
import { ChartError } from '@/components/charts/chart-error'
import {
  ChartDashboardUsageP95,
  ChartDashboardUsageQueries,
  ChartDashboardUsageTop,
} from '@/components/charts/dashboard-usage/dashboard-usage-charts'
import { ChartSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { KpiTiles } from '@/components/usage/kpi-tiles'
import { formatCompactNumber } from '@/lib/format-readable'
import { useTableData } from '@/lib/query/use-table-data'
import { dashboardUsageSummaryConfig } from '@/lib/query-config/queries/dashboard-usage'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

export const DASHBOARD_USAGE_DAY_OPTIONS = ['1', '7', '30'] as const

/** `?days=` as one of the offered windows; anything else is 7. */
export function parseUsageDays(value: string | null): string {
  return DASHBOARD_USAGE_DAY_OPTIONS.find((d) => d === value) ?? '7'
}

/** Hourly buckets up to a week, daily beyond. */
export function usageInterval(days: string): ClickHouseInterval {
  return Number(days) > 7 ? 'toStartOfDay' : 'toStartOfHour'
}

export interface DashboardUsageSummaryRow {
  queries: number
  users: number
  errors: number
  error_pct: number | null
  p95_ms: number
  readable_bytes_read: string
  email: string
  window_days: number
}

/** KPI tiles; `withUsers` is false on the one-user page. Pure for tests. */
export function buildDashboardUsageKpis(
  row: DashboardUsageSummaryRow,
  withUsers: boolean
): KpiTile[] {
  const errorPct = Number(row.error_pct ?? 0)
  return [
    { label: 'Queries', value: formatCompactNumber(Number(row.queries)) },
    ...(withUsers
      ? [{ label: 'Users', value: formatCompactNumber(Number(row.users)) }]
      : []),
    {
      label: 'Error rate',
      value: `${errorPct.toFixed(errorPct > 0 && errorPct < 1 ? 2 : 1)}%`,
    },
    {
      label: 'p95 duration',
      value: `${Number(row.p95_ms).toLocaleString()} ms`,
    },
    { label: 'Bytes read', value: row.readable_bytes_read },
  ]
}

function useSummary(user: string, days: string) {
  const hostId = useHostId()
  return useTableData<DashboardUsageSummaryRow>(
    dashboardUsageSummaryConfig.name,
    hostId,
    { days, dashboard_user: user }
  )
}

/** The opt-in email of one dashboard user, or nothing. */
export function DashboardUserEmail({
  user,
  days,
}: {
  user: string
  days: string
}) {
  const { data } = useSummary(user, days)
  const email = data?.[0]?.email
  if (!email) return null
  return <span className="text-muted-foreground text-sm">{email}</span>
}

function SummaryTiles({ user, days }: { user: string; days: string }) {
  const { data, error, isLoading, hasData, refresh } = useSummary(user, days)
  const withUsers = user === ''
  const count = withUsers ? 5 : 4
  if (isLoading && !hasData)
    return <KpiTiles tiles={null} loadingCount={count} />
  const row = data?.[0]
  if (error && !row) {
    return <ChartError error={error} title="Totals" onRetry={() => refresh()} />
  }
  if (!row) return null
  return (
    <KpiTiles
      tiles={buildDashboardUsageKpis(row, withUsers)}
      loadingCount={count}
    />
  )
}

export function DaySelector({
  days,
  href,
}: {
  days: string
  href: (days: string) => string
}) {
  return (
    <div className="ml-auto flex items-center gap-1 text-sm">
      {DASHBOARD_USAGE_DAY_OPTIONS.map((d) => (
        <Link
          key={d}
          href={href(d)}
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
  )
}

const TOP_TITLES = {
  user: 'Top Users',
  source: 'Top Sources',
  page: 'Top Pages',
  version: 'Versions',
  label: 'Deployment Labels',
} as const

interface DashboardUsageOverviewProps {
  /** '' for every user. */
  user: string
  days: string
  dimensions: ReadonlyArray<keyof typeof TOP_TITLES>
}

/** KPI tiles, the two time series and the top-N bars, for all or one user. */
export function DashboardUsageOverview({
  user,
  days,
  dimensions,
}: DashboardUsageOverviewProps) {
  const lastHours = Number(days) * 24
  const interval = usageInterval(days)
  const userParams = { dashboard_user: user }

  return (
    <>
      <SummaryTiles user={user} days={days} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ChartSkeleton />}>
          <ChartDashboardUsageQueries
            lastHours={lastHours}
            interval={interval}
            params={userParams}
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <ChartDashboardUsageP95
            lastHours={lastHours}
            interval={interval}
            params={userParams}
          />
        </Suspense>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dimensions.map((dimension) => (
          <Suspense key={dimension} fallback={<ChartSkeleton />}>
            <ChartDashboardUsageTop
              title={TOP_TITLES[dimension]}
              lastHours={lastHours}
              params={{ ...userParams, dimension }}
            />
          </Suspense>
        ))}
      </div>
    </>
  )
}
