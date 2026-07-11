/**
 * Daily summary math + D1 collection.
 */

import {
  collectSummary,
  type D1SummaryDb,
  type PlanBreakdownRow,
  reduceSummary,
} from './summary'
import { describe, expect, test } from 'bun:test'

describe('reduceSummary — MRR math', () => {
  test('monthly + yearly + free normalize into a monthly MRR', () => {
    const rows: PlanBreakdownRow[] = [
      { plan_id: 'pro', billing_period: 'monthly', n: 2 },
      { plan_id: 'max', billing_period: 'yearly', n: 1 },
      { plan_id: 'free', billing_period: 'monthly', n: 5 },
    ]
    const data = reduceSummary(rows, 3)
    // pro: 2 * $29 = 58 ; max yearly: 990/12 = 82.5 ; free: 0  → 140.5
    expect(data.mrrUsd).toBe(140.5)
    expect(data.totalActive).toBe(8)
    expect(data.byPlan).toEqual({ pro: 2, max: 1, free: 5 })
    expect(data.newLast24h).toBe(3)
  })

  test('an unknown plan id contributes 0 MRR but still counts', () => {
    const data = reduceSummary(
      [{ plan_id: 'mystery', billing_period: 'monthly', n: 4 }],
      0
    )
    expect(data.mrrUsd).toBe(0)
    expect(data.totalActive).toBe(4)
  })

  test('empty breakdown is a zeroed summary', () => {
    const data = reduceSummary([], 0)
    expect(data).toEqual({
      totalActive: 0,
      byPlan: {},
      newLast24h: 0,
      mrrUsd: 0,
    })
  })
})

describe('collectSummary — D1 queries', () => {
  function fakeDb(breakdown: PlanBreakdownRow[], newCount: number) {
    const holder = { sinceBound: null as number | null }
    const db: D1SummaryDb = {
      prepare(sql: string) {
        const isBreakdown = /GROUP BY plan_id/.test(sql)
        return {
          bind(...values: unknown[]) {
            if (!isBreakdown) holder.sinceBound = values[0] as number
            return {
              async all<T = unknown>() {
                return { results: breakdown as unknown as T[] }
              },
              async first<T = unknown>() {
                return { n: newCount } as T
              },
            }
          },
        }
      },
    }
    return { db, holder }
  }

  test('reduces the two queries and derives the 24h cutoff from `now`', async () => {
    const { db, holder } = fakeDb(
      [{ plan_id: 'pro', billing_period: 'monthly', n: 1 }],
      7
    )
    const now = 1_000_000
    const data = await collectSummary(db, now)
    expect(data.mrrUsd).toBe(29)
    expect(data.newLast24h).toBe(7)
    expect(holder.sinceBound).toBe(now - 24 * 60 * 60)
  })
})
