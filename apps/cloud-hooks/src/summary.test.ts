/**
 * Daily summary math + D1 collection + digest assembly (partial data).
 */

import {
  collectSummary,
  type D1SummaryDb,
  formatDigest,
  type PlanBreakdownRow,
  reduceSummary,
  type SummaryData,
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
      newByPlan: {},
      cancellations24h: 0,
      mrrUsd: 0,
    })
  })

  test('extras carry the 24h deltas through', () => {
    const data = reduceSummary([], 2, {
      newByPlan: { pro: 1, free: 1 },
      cancellations24h: 3,
    })
    expect(data.newByPlan).toEqual({ pro: 1, free: 1 })
    expect(data.cancellations24h).toBe(3)
  })
})

describe('collectSummary — D1 queries', () => {
  function fakeDb() {
    const holder = { sinceBounds: [] as number[] }
    const db: D1SummaryDb = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            if (values.length > 0) holder.sinceBounds.push(values[0] as number)
            return {
              async all<T = unknown>() {
                if (/created_at >=/.test(sql)) {
                  // new-by-plan query
                  return {
                    results: [{ plan_id: 'pro', n: 1 }] as unknown as T[],
                  }
                }
                // active breakdown query
                return {
                  results: [
                    { plan_id: 'pro', billing_period: 'monthly', n: 1 },
                  ] as unknown as T[],
                }
              },
              async first<T = unknown>() {
                if (/status IN/.test(sql)) return { n: 2 } as T // cancellations
                return { n: 7 } as T // new-count
              },
            }
          },
        }
      },
    }
    return { db, holder }
  }

  test('reduces the queries and derives the 24h cutoff from `now`', async () => {
    const { db, holder } = fakeDb()
    const now = 1_000_000
    const data = await collectSummary(db, now)
    expect(data.mrrUsd).toBe(29)
    expect(data.newLast24h).toBe(7)
    expect(data.newByPlan).toEqual({ pro: 1 })
    expect(data.cancellations24h).toBe(2)
    // every windowed query uses the same 24h cutoff
    for (const b of holder.sinceBounds) expect(b).toBe(now - 24 * 60 * 60)
  })
})

describe('formatDigest — sections degrade gracefully', () => {
  const base: SummaryData = {
    totalActive: 3,
    byPlan: { pro: 2, free: 1 },
    newLast24h: 1,
    newByPlan: { pro: 1 },
    cancellations24h: 0,
    mrrUsd: 58,
  }

  test('billing-only digest omits Users and Surfaces sections', () => {
    const msg = formatDigest(base)
    expect(msg).toContain('Subscriptions')
    expect(msg).toContain('Estimated MRR')
    expect(msg).not.toContain('Users')
    expect(msg).not.toContain('Surfaces')
  })

  test('Clerk metrics add a Users section', () => {
    const msg = formatDigest(base, {
      clerk: { totalUsers: 42, newUsers24h: 3 },
    })
    expect(msg).toContain('Users')
    expect(msg).toContain('42')
    expect(msg).toContain('New in 24h: 3')
  })

  test('a probe snapshot adds a Surfaces section flagging down surfaces', () => {
    const msg = formatDigest(base, {
      probes: { dashboard: 'up', docs: 'down' },
    })
    expect(msg).toContain('Surfaces')
    expect(msg).toContain('1 down')
    expect(msg).toContain('docs')
  })

  test('an all-up probe snapshot shows the healthy header', () => {
    const msg = formatDigest(base, {
      probes: { dashboard: 'up', docs: 'up' },
    })
    expect(msg).toContain('all up')
  })
})
