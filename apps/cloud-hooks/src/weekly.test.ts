/**
 * Weekly report — equal-length comparison windows, trend rendering, degradation.
 */

import type { D1SummaryDb } from './summary'

import {
  collectWeekly,
  formatTrend,
  formatWeekly,
  startOfUtcDay,
  WEEK,
  weekBounds,
} from './weekly'
import { describe, expect, test } from 'bun:test'

/** Monday 2026-07-27T01:00:00Z — when the weekly cron fires. */
const NOW = Math.floor(Date.parse('2026-07-27T01:00:00Z') / 1000)

interface Call {
  sql: string
  binds: unknown[]
}

function fakeDb(
  counts: Record<string, number> = {},
  planRows: unknown[] = [],
  calls: Call[] = []
): D1SummaryDb & { calls: Call[] } {
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async all<T>() {
              calls.push({ sql, binds })
              return { results: planRows as T[] }
            },
            async first<T>() {
              calls.push({ sql, binds })
              const kind = sql.includes('canceled') ? 'cancel' : 'new'
              const key = `${kind}:${binds[0]}`
              return { n: counts[key] ?? 0 } as T
            },
          }
        },
      }
    },
  }
}

describe('week bounds', () => {
  test('anchors on start-of-today, not the moment the cron ran', () => {
    // The 01:00 run time must not shift the window, or the two periods would
    // be misaligned against the day-granular data.
    expect(startOfUtcDay(NOW)).toBe(
      Math.floor(Date.parse('2026-07-27T00:00:00Z') / 1000)
    )
  })

  test('produces two adjacent windows of exactly equal length', () => {
    const { prevStart, start, end } = weekBounds(NOW)
    expect(end - start).toBe(WEEK)
    expect(start - prevStart).toBe(WEEK)
    // Adjacent, non-overlapping: last week ends exactly where this week starts.
    expect(start).toBe(prevStart + WEEK)
  })

  test('reports the 7 complete days before the run', async () => {
    const data = await collectWeekly(fakeDb(), NOW)
    // Run on Monday the 27th → covers Mon 20th through Sun 26th.
    expect(data.weekStart).toBe('2026-07-20')
    expect(data.weekEnd).toBe('2026-07-26')
  })
})

describe('collectWeekly', () => {
  test('compares this week against the previous week on the same query', async () => {
    const { prevStart, start } = weekBounds(NOW)
    const db = fakeDb({
      [`new:${start}`]: 5,
      [`new:${prevStart}`]: 2,
      [`cancel:${start}`]: 1,
      [`cancel:${prevStart}`]: 3,
    })
    const data = await collectWeekly(db, NOW)

    expect(data.newSubscriptions).toEqual({ current: 5, previous: 2 })
    expect(data.cancellations).toEqual({ current: 1, previous: 3 })
  })

  test('derives active counts and MRR from the shared plan breakdown', async () => {
    const db = fakeDb({}, [
      { plan_id: 'pro', billing_period: 'monthly', n: 2 },
      { plan_id: 'pro', billing_period: 'yearly', n: 1 },
    ])
    const data = await collectWeekly(db, NOW)

    expect(data.billing.totalActive).toBe(3)
    expect(data.billing.byPlan.pro).toBe(3)
    // Non-zero MRR proves the shared pricing math ran (yearly ÷ 12 included).
    expect(data.billing.mrrUsd).toBeGreaterThan(0)
  })
})

describe('formatTrend', () => {
  test('shows direction and delta against last week', () => {
    expect(formatTrend({ current: 5, previous: 2 })).toBe('5 (▲ +3 vs 2)')
    expect(formatTrend({ current: 1, previous: 3 })).toBe('1 (▼ -2 vs 3)')
  })

  test('says flat rather than "+0"', () => {
    expect(formatTrend({ current: 4, previous: 4 })).toBe('4 (flat vs 4)')
  })

  test('omits a meaningless comparison against an empty previous week', () => {
    expect(formatTrend({ current: 3, previous: 0 })).toBe('3')
    expect(formatTrend({ current: 0, previous: 0 })).toBe('0')
  })
})

describe('formatWeekly', () => {
  const data = {
    weekStart: '2026-07-20',
    weekEnd: '2026-07-26',
    billing: {
      totalActive: 3,
      byPlan: { pro: 3 },
      newLast24h: 0,
      newByPlan: {},
      cancellations24h: 0,
      mrrUsd: 87,
    },
    newSubscriptions: { current: 5, previous: 2 },
    cancellations: { current: 1, previous: 3 },
  }

  test('always reports the period and the billing core', () => {
    const text = formatWeekly(data)
    expect(text).toContain('2026-07-20 → 2026-07-26')
    expect(text).toContain('New this week: 5 (▲ +3 vs 2)')
    expect(text).toContain('$87.00')
  })

  test('omits every optional section when its source is unavailable', () => {
    const text = formatWeekly(data)
    expect(text).not.toContain('Users')
    expect(text).not.toContain('Usage')
    expect(text).not.toContain('Issues')
    expect(text).not.toContain('Surfaces')
  })

  test('includes optional sections when their sources answered', () => {
    const text = formatWeekly(data, {
      clerk: { totalUsers: 40, newUsers: 6, windowSeconds: 7 * 86400 },
      usage: {
        referenceDay: '2026-07-26',
        dashboard: { dau: 10, wau: 40, mau: 120 },
        cli: { dau: 2, wau: 5, mau: 11 },
        cliInstalls24h: 0,
      },
      issues: { opened: 9, closed: 4 },
      probes: { dashboard: 'up', docs: 'down' },
    })

    expect(text).toContain('New in 7d: 6') // window label follows the window
    expect(text).toContain('DAU 10')
    expect(text).toContain('Opened: 9')
    expect(text).toContain('1 down')
  })
})
