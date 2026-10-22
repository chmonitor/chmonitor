/**
 * #4125 follow-ups: per-user calendar and hour heatmap charts, KPI tiles,
 * query_kind / interface tables, `/usage` name filter and system-user toggle,
 * roles header, and the 90d / 1y presets. Every scan is read-only, bound, and
 * capped in SQL, because URL params reach ClickHouse unchanged.
 */

import type { QueryConfig } from '@/types/query-config'

import {
  USAGE_FILTER_DEFAULTS,
  USAGE_LIST_PRESETS,
  usageByUserConfig,
  usageInactiveUsersConfig,
  usageListSearchParams,
} from '../queries/usage'
import {
  USER_USAGE_DAY_OPTIONS,
  userUsageConfigs,
  userUsageDailyConfig,
  userUsageInterfacesConfig,
  userUsageKindsConfig,
  userUsageProfileConfig,
  userUsageSummaryConfig,
} from '../queries/user-usage'
import { describe, expect, test } from 'bun:test'
import { buildDrilldownHref } from '@/components/charts/query/query-count-heatmap'
import { buildHourGrid } from '@/components/charts/query/query-hour-heatmap'
import { getFilterToggleHref } from '@/components/data-table/utils/filter-url-builder'
import { buildUserUsageKpis } from '@/components/usage/user-usage-header'
import { getChartQuery } from '@/lib/api/chart-registry'
import { getQueryConfigByName } from '@/lib/query-config'

const sqlOf = (c: { sql: QueryConfig['sql'] }): string =>
  typeof c.sql === 'string' ? c.sql : c.sql.map((v) => v.sql).join('\n')

interface SingleChart {
  query: string
  queryParams?: Record<string, unknown>
  permission?: unknown
}
const chart = (name: string, lastHours?: number, user?: string) =>
  getChartQuery(name, {
    lastHours,
    params: user === undefined ? undefined : { user },
  }) as SingleChart

const INJECTION = "x' OR 1=1 --"

describe('per-user activity calendar (query-count-heatmap + user param)', () => {
  test('binds the user, caps the window at 365 days in SQL, LIMIT 366, queries gate', () => {
    const q = chart('query-count-heatmap', 24 * 365 * 5, INJECTION)
    expect(q.query).toContain('user = {user:String}')
    expect(q.query).not.toContain(INJECTION)
    expect(q.queryParams).toEqual({ user: INJECTION, days: 365 })
    expect(q.query).toContain(
      'event_date >= today() - least({days:UInt16}, 365)'
    )
    expect(q.query).toMatch(/LIMIT 366\s*$/)
    expect(q.permission).toEqual({ feature: 'queries' })
  })

  test('window follows lastHours (7d -> 7 days)', () => {
    expect(chart('query-count-heatmap', 24 * 7, 'a').queryParams?.days).toBe(7)
  })

  test('without a user the server-wide calendar is unchanged', () => {
    for (const q of [
      chart('query-count-heatmap', 24 * 365),
      chart('query-count-heatmap', 24 * 365, ''),
    ]) {
      expect(q.query).not.toContain('{user:String}')
      expect(q.queryParams).toBeUndefined()
      expect(q.permission).toBeUndefined()
    }
  })
})

describe('hour heatmap chart (query-hour-heatmap)', () => {
  test('user is bound, window capped at 30 days, 168 cells max, queries gate', () => {
    const q = chart('query-hour-heatmap', 24 * 365, INJECTION)
    expect(q.query).not.toContain(INJECTION)
    expect(q.queryParams).toEqual({ user: INJECTION, days: 30 })
    expect(q.query).toContain(
      'event_date >= today() - least({days:UInt16}, 30)'
    )
    expect(q.query).toMatch(/LIMIT 168\s*$/)
    expect(q.query).not.toContain('QueryStart')
    expect(q.permission).toEqual({ feature: 'queries' })
  })

  test('no user means all users (empty bound param), default 7 days', () => {
    const q = chart('query-hour-heatmap')
    expect(q.queryParams).toEqual({ user: '', days: 7 })
    expect(q.query).toContain("({user:String} = '' OR user = {user:String})")
  })

  test('buildHourGrid fills 7 x 24 with zeros and finds the max', () => {
    const { grid, max } = buildHourGrid([
      { weekday: 1, hour: 0, queries: 3 },
      { weekday: 7, hour: 23, queries: 9 },
    ])
    expect(grid).toHaveLength(7)
    expect(grid.every((r) => r.length === 24)).toBe(true)
    expect(grid[0][0]).toBe(3)
    expect(grid[6][23]).toBe(9)
    expect(grid[3][12]).toBe(0)
    expect(max).toBe(9)
  })
})

describe('KPI tiles (user-usage-summary)', () => {
  const sql = sqlOf(userUsageSummaryConfig)

  test('30-day cap, end events, one row, reports the window it really read', () => {
    expect(sql).toContain('event_date >= today() - least({days:UInt16}, 30)')
    expect(sql).toContain('user = {user:String}')
    expect(sql).toContain('least({days:UInt16}, 30) AS window_days')
    expect(sql).toMatch(/LIMIT 1\s*$/)
    expect(sql).not.toContain('QueryStart')
    expect(userUsageSummaryConfig.permission).toEqual({ feature: 'queries' })
    // Not a table: it must not be rendered by the per-config table loop.
    expect(userUsageConfigs).not.toContain(userUsageSummaryConfig)
  })

  test('tiles: queries, failed %, p95, bytes read', () => {
    expect(
      buildUserUsageKpis({
        queries: 1500,
        failed: 3,
        failed_pct: 0.2,
        p95_ms: 1234,
        readable_bytes_read: '1.00 GiB',
        window_days: 30,
      })
    ).toEqual([
      { label: 'Queries', value: '1.5K' },
      { label: 'Failed', value: '0.20%' },
      { label: 'p95 duration', value: '1,234 ms' },
      { label: 'Bytes read', value: '1.00 GiB' },
    ])
  })

  test('a user with no queries shows 0% failed, not NaN', () => {
    const kpis = buildUserUsageKpis({
      queries: 0,
      failed: 0,
      failed_pct: null,
      p95_ms: 0,
      readable_bytes_read: '0.00 B',
      window_days: 7,
    })
    expect(kpis[1].value).toBe('0.0%')
  })
})

describe('query_kind and interface breakdowns', () => {
  for (const c of [userUsageKindsConfig, userUsageInterfacesConfig]) {
    test(`${c.name}: in the page tables, 30-day cap, user bound, LIMIT 50`, () => {
      const sql = sqlOf(c)
      expect(userUsageConfigs).toContain(c)
      expect(sql).toContain('user = {user:String}')
      expect(sql).toContain('event_date >= today() - least({days:UInt16}, 30)')
      expect(sql).toMatch(/LIMIT 50\s*$/)
      expect(sql).toContain('AS pct_queries')
      expect(c.permission).toEqual({ feature: 'queries' })
    })
  }

  test('interface codes are named', () => {
    const sql = sqlOf(userUsageInterfacesConfig)
    expect(sql).toContain("'TCP', 'HTTP', 'gRPC', 'MySQL', 'PostgreSQL'")
  })
})

describe('/usage name filter and hide-system toggle', () => {
  const configs = [usageByUserConfig, usageInactiveUsersConfig]

  test('both tables apply the bound filters with defaults for every param', () => {
    for (const c of configs) {
      const sql = sqlOf(c)
      expect(sql).toContain('positionCaseInsensitive(')
      expect(sql).toContain('{name_filter:String}')
      expect(sql).toContain("{hide_system:String} != '1'")
      expect(sql).toContain('{system_users:String}')
      expect(sql).not.toMatch(/\bLIKE\b/)
      expect(c.defaultParams).toMatchObject(USAGE_FILTER_DEFAULTS)
      expect(c.filterParamPresets).toBe(USAGE_LIST_PRESETS)
    }
    expect(USAGE_LIST_PRESETS).toContainEqual({
      name: 'Hide system users',
      key: 'hide_system',
      value: '1',
    })
  })

  test('the page forwards days, name and toggle, never the system-user list', () => {
    const url = new URLSearchParams(
      'days=30&name_filter=ana&hide_system=1&system_users=x&host=0'
    )
    expect(usageListSearchParams(url)).toEqual({
      days: '30',
      name_filter: 'ana',
      hide_system: '1',
    })
  })

  test('the /usage presets never offer a window past the 30-day cap', () => {
    const days = USAGE_LIST_PRESETS.filter((p) => p.key === 'days')
    expect(days.every((p) => Number(p.value) <= 30)).toBe(true)
  })
})

describe('roles / profile header (user-usage-profile)', () => {
  const sql = sqlOf(userUsageProfileConfig)

  test('gated on the security feature like the users and roles pages', () => {
    expect(userUsageProfileConfig.permission).toEqual({ feature: 'security' })
    expect(getQueryConfigByName('user-usage-profile')?.permission).toEqual({
      feature: 'security',
    })
  })

  test('reads access tables only, user bound everywhere, one row', () => {
    expect(sql).not.toContain('query_log')
    expect((sql.match(/\{user:String\}/g) ?? []).length).toBe(3)
    expect(sql).toMatch(/LIMIT 1\s*$/)
    expect(sql).not.toMatch(/\b(GRANT|REVOKE|ALTER|DROP|INSERT INTO)\b/)
    expect(userUsageProfileConfig.optional).toBe(true)
    expect(userUsageConfigs).not.toContain(userUsageProfileConfig)
  })
})

describe('90d and 1y presets', () => {
  test('/usage/user offers 7, 30, 90 and 365 days', () => {
    expect(USER_USAGE_DAY_OPTIONS).toEqual(['7', '30', '90', '365'])
  })

  test('only the daily table offers windows past 30 days', () => {
    expect(
      userUsageDailyConfig.filterParamPresets?.map((p) => p.value)
    ).toEqual(['7', '30', '90', '365'])
    for (const c of userUsageConfigs.filter((c) => c !== userUsageDailyConfig))
      for (const p of c.filterParamPresets ?? [])
        expect(Number(p.value)).toBeLessThanOrEqual(30)
  })

  test('new configs are registered for /api/v1/tables', () => {
    for (const name of [
      'user-usage-kinds',
      'user-usage-interfaces',
      'user-usage-summary',
      'user-usage-profile',
    ])
      expect(getQueryConfigByName(name)).toBeDefined()
  })
})

describe('UI wiring', () => {
  test('per-user calendar drill-down keeps the user filter', () => {
    const href = buildDrilldownHref(0, { iso: '2026-10-01' }, 'failed', 'a&b')
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/history-queries')
    expect(url.searchParams.get('user')).toBe('eq:a&b')
    expect(
      buildDrilldownHref(0, { iso: '2026-10-01' }, 'failed').startsWith(
        '/failed-queries?'
      )
    ).toBe(true)
  })

  test('the hide-system preset toggles without dropping the name filter', () => {
    const on = getFilterToggleHref(
      '/usage',
      new URLSearchParams('name_filter=ana&host=0'),
      'hide_system',
      '1',
      usageByUserConfig.defaultParams
    )
    const onUrl = new URL(on, 'http://x')
    expect(onUrl.searchParams.get('name_filter')).toBe('ana')
    expect(onUrl.searchParams.get('hide_system')).toBe('1')
    // Default '' means toggling off removes the key instead of sending ''.
    const off = getFilterToggleHref(
      '/usage',
      onUrl.searchParams,
      'hide_system',
      '1',
      usageByUserConfig.defaultParams
    )
    expect(new URL(off, 'http://x').searchParams.has('hide_system')).toBe(false)
  })
})
