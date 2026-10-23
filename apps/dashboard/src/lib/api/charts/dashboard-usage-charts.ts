import type { ChartQueryBuilder, ChartQueryParams } from './types'

import {
  applyInterval,
  CHART_QUERY_SETTINGS,
  fillStep,
  nowOrToday,
} from './types'
import {
  DASHBOARD_USAGE_MAX_DAYS,
  dashboardUsageAttr,
  dashboardUsageWhere,
} from '@/lib/query-config/queries/dashboard-usage'

const OPERATIONS_PERMISSION = { feature: 'operations' } as const

/**
 * Attribution fields the "top" bar charts group by. The chart param picks one
 * by name; anything else is refused, so the SQL never interpolates input.
 */
export const DASHBOARD_USAGE_DIMENSIONS = {
  user: '(anonymous or cron)',
  source: '(unknown)',
  page: '(unknown)',
  version: '(unknown)',
  label: '(no label)',
} as const

export type DashboardUsageDimension = keyof typeof DASHBOARD_USAGE_DIMENSIONS

function isDimension(value: unknown): value is DashboardUsageDimension {
  return (
    typeof value === 'string' &&
    Object.hasOwn(DASHBOARD_USAGE_DIMENSIONS, value)
  )
}

/** Window in whole hours, clamped to [1, 30 days]. */
export function dashboardUsageHours(lastHours: number | undefined): number {
  const max = DASHBOARD_USAGE_MAX_DAYS * 24
  const hours = Number.isFinite(lastHours) ? Math.ceil(Number(lastHours)) : max
  return Math.min(max, Math.max(1, hours))
}

/**
 * Bound params shared by every dashboard usage chart: the window (also capped
 * in SQL, since chart params reach the builder from the URL) and the optional
 * dashboard user, never interpolated.
 */
function scanParams({ lastHours, params }: ChartQueryParams) {
  const user = params?.dashboard_user
  return {
    hours: dashboardUsageHours(lastHours),
    dashboard_user: typeof user === 'string' ? user : '',
  }
}

export const dashboardUsageCharts: Record<string, ChartQueryBuilder> = {
  // Queries, errors and p95 duration per bucket; the line charts on both
  // Dashboard Usage pages read different columns of this one result.
  'dashboard-usage-over-time': (args) => {
    const interval = args.interval ?? 'toStartOfHour'
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      permission: OPERATIONS_PERMISSION,
      queryParams: scanParams(args),
      query: `
    SELECT
        ${applyInterval(interval, 'event_time', 'bucket')},
        count() AS queries,
        countIf(type != 'QueryFinish') AS errors,
        round(quantile(0.95)(query_duration_ms)) AS p95_ms
    FROM merge('system', '^query_log')
    ${dashboardUsageWhere}
    GROUP BY bucket
    ORDER BY bucket WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
    }
  },

  // Top 10 values of one attribution field by query count.
  'dashboard-usage-top': (args) => {
    const dimension = args.params?.dimension
    if (!isDimension(dimension)) {
      throw new Error(
        `dashboard-usage-top: dimension must be one of ${Object.keys(DASHBOARD_USAGE_DIMENSIONS).join(', ')}`
      )
    }
    const value = dashboardUsageAttr(dimension)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      permission: OPERATIONS_PERMISSION,
      queryParams: scanParams(args),
      query: `
    SELECT
        if(${value} = '', '${DASHBOARD_USAGE_DIMENSIONS[dimension]}', ${value}) AS name,
        count() AS queries
    FROM merge('system', '^query_log')
    ${dashboardUsageWhere}
    GROUP BY name
    ORDER BY queries DESC, name
    LIMIT 10
  `,
    }
  },
}
