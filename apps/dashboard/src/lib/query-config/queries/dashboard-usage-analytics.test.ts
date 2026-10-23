/**
 * Dashboard Usage analytics: KPI totals, time series, top-N bars and the
 * one-user detail. The record names every signed-in user, so everything is
 * admin-only; the one-user filter is a bound param; scans are capped in SQL
 * because chart and table params arrive from the URL.
 */

import { describe, expect, test } from 'bun:test'
import {
  buildDashboardUsageKpis,
  parseUsageDays,
  usageInterval,
} from '@/components/usage/dashboard-usage-overview'
import { getChartQuery } from '@/lib/api/chart-registry'
import {
  DASHBOARD_USAGE_DIMENSIONS,
  dashboardUsageCharts,
  dashboardUsageHours,
} from '@/lib/api/charts/dashboard-usage-charts'
import { queries as queryConfigs } from '@/lib/query-config'
import {
  allDashboardUsageConfigs,
  dashboardUsageSummaryConfig,
} from '@/lib/query-config/queries/dashboard-usage'

const EVIL = "jane' OR 1=1 --"

function chart(name: string, params: Record<string, unknown>, lastHours = 24) {
  const built = getChartQuery(name, { lastHours, params })
  if (!built || !('query' in built)) throw new Error(`no chart ${name}`)
  return built
}

describe('dashboard usage charts', () => {
  const cases = [
    ['dashboard-usage-over-time', {}],
    ...Object.keys(DASHBOARD_USAGE_DIMENSIONS).map(
      (dimension) => ['dashboard-usage-top', { dimension }] as const
    ),
  ] as const

  test('every chart is registered and covered here', () => {
    for (const name of Object.keys(dashboardUsageCharts)) {
      expect(cases.some(([n]) => n === name)).toBe(true)
    }
  })

  for (const [name, extra] of cases) {
    test(`${name} ${JSON.stringify(extra)}: operations gate, bound user, bounded scan`, () => {
      const built = chart(name, { ...extra, dashboard_user: EVIL })
      expect(built.permission).toEqual({ feature: 'operations' })
      expect(built.query).not.toContain(EVIL)
      expect(built.queryParams?.dashboard_user).toBe(EVIL)
      expect(built.query).toContain('{dashboard_user:String}')
      expect(built.query).toMatch(
        /event_date >= toDate\(now\(\) - toIntervalHour\(least\(\{hours:UInt32\}, 720\)\)\)/
      )
      expect(built.query).toMatch(
        /event_time >= now\(\) - toIntervalHour\(least\(\{hours:UInt32\}, 720\)\)/
      )
    })
  }

  test('no user means everyone: an empty bound param', () => {
    expect(
      chart('dashboard-usage-over-time', {}).queryParams?.dashboard_user
    ).toBe('')
  })

  test('window is capped at 30 days and floored at 1 hour', () => {
    expect(dashboardUsageHours(24 * 365)).toBe(720)
    expect(dashboardUsageHours(0)).toBe(1)
    expect(dashboardUsageHours(undefined)).toBe(720)
    expect(
      chart('dashboard-usage-over-time', {}, 24 * 7).queryParams?.hours
    ).toBe(168)
  })

  test('the top chart refuses a field outside the record', () => {
    expect(() => chart('dashboard-usage-top', { dimension: 'query' })).toThrow()
  })

  test('the top chart answers default params, so the live chart sweep can run it', () => {
    const built = chart('dashboard-usage-top', {})
    expect(built.query).toBe(
      chart('dashboard-usage-top', { dimension: 'user' }).query
    )
  })
})

describe('dashboard usage configs', () => {
  test('every config is admin-only, registered and binds a default for every param', () => {
    const registered = new Set(queryConfigs.map((c) => c.name))
    for (const config of allDashboardUsageConfigs) {
      expect(config.permission).toEqual({ feature: 'operations' })
      expect(registered.has(config.name)).toBe(true)
      expect(config.sql as string).toContain('{dashboard_user:String}')
      expect(config.defaultParams).toEqual({ days: '7', dashboard_user: '' })
      expect(config.sql as string).toMatch(
        /event_date >= today\(\) - least\(\{days:UInt16\}, 30\)/
      )
    }
  })

  test('email is read only for one user, only from log_comment', () => {
    const sql = dashboardUsageSummaryConfig.sql as string
    expect(sql).toContain("if({dashboard_user:String} = '', ''")
    expect(sql).toContain("JSONExtractString(log_comment, 'email')")
    for (const config of allDashboardUsageConfigs) {
      if (config === dashboardUsageSummaryConfig) continue
      expect(config.sql as string).not.toContain("'email'")
    }
  })

  test('By User links each user to the detail page and keeps host and days', () => {
    const byUser = allDashboardUsageConfigs.find(
      (c) => c.name === 'dashboard-usage-by-user'
    )
    expect(byUser?.columnFormats?.dashboard_user).toEqual([
      expect.anything(),
      {
        href: '/dashboard-usage/user?user=[user_param]&days=[ctx.days]&host=[ctx.hostId]',
      },
    ])
    expect(byUser?.sql as string).toContain('AS user_param')
  })
})

describe('dashboard usage page helpers', () => {
  test('only the offered windows reach the queries', () => {
    expect(parseUsageDays('30')).toBe('30')
    expect(parseUsageDays('365')).toBe('7')
    expect(parseUsageDays(null)).toBe('7')
  })

  test('hourly buckets up to a week, daily for 30 days', () => {
    expect(usageInterval('1')).toBe('toStartOfHour')
    expect(usageInterval('7')).toBe('toStartOfHour')
    expect(usageInterval('30')).toBe('toStartOfDay')
  })

  test('KPI tiles: users only on the global page, error rate never NaN', () => {
    const row = {
      queries: 1234,
      users: 3,
      errors: 0,
      error_pct: null,
      p95_ms: 1500,
      readable_bytes_read: '1.00 MiB',
      email: '',
      window_days: 7,
    }
    expect(buildDashboardUsageKpis(row, true).map((k) => k.label)).toEqual([
      'Queries',
      'Users',
      'Error rate',
      'p95 duration',
      'Bytes read',
    ])
    const one = buildDashboardUsageKpis(row, false)
    expect(one.map((k) => k.label)).not.toContain('Users')
    expect(one.find((k) => k.label === 'Error rate')?.value).toBe('0.0%')
  })
})
