import { describe, expect, it } from 'bun:test'
import { buildUserDailySeries } from '@/components/usage/user-daily-chart'
import {
  DEFAULT_USER_USAGE_TAB,
  resolveUserUsageTab,
  USER_USAGE_TABS,
} from '@/components/usage/user-usage-tabs'
import { userUsageConfigs } from '@/lib/query-config/queries/user-usage'

describe('user usage tabs', () => {
  it('shows every usage table in exactly one tab, so none disappears', () => {
    const placed = USER_USAGE_TABS.flatMap((t) => t.tables).sort()
    expect(placed).toEqual(userUsageConfigs.map((c) => c.name).sort())
  })

  it('falls back to the default tab for a missing or unknown ?tab=', () => {
    expect(resolveUserUsageTab(null)).toBe(DEFAULT_USER_USAGE_TAB)
    expect(resolveUserUsageTab('nope')).toBe(DEFAULT_USER_USAGE_TAB)
    expect(resolveUserUsageTab('errors')).toBe('errors')
  })
})

describe('buildUserDailySeries', () => {
  const row = (date: string, q: number, f: number) => ({
    date,
    query_count: q,
    failed_count: f,
    memory_peak: 0,
    avg_duration_ms: 0,
    written_bytes: 0,
  })

  it('has one point per day in the window, idle days as zero', () => {
    const series = buildUserDailySeries(
      [row('2026-10-24', 5, 1), row('2026-10-01', 9, 0)],
      3,
      new Date('2026-10-26T15:00:00Z')
    )
    expect(series).toEqual([
      { day: '2026-10-24', queries: 5, failed: 1 },
      { day: '2026-10-25', queries: 0, failed: 0 },
      { day: '2026-10-26', queries: 0, failed: 0 },
    ])
  })
})
