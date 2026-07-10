/**
 * Unit tests for ai-usage-store.ts
 *
 * Uses a minimal in-memory D1 fake injected via mock.module('@chm/platform')
 * — the same pattern as src/lib/insights/store/d1-store.test.ts — so the
 * store's real SQL is exercised without requiring a Cloudflare Workers runtime.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@chm/pricing'

// ---------------------------------------------------------------------------
// In-memory D1 fake
// ---------------------------------------------------------------------------

/** Keyed by "owner_id::day" → count */
type UsageStore = Map<string, number>

function makeFakeD1(store: UsageStore) {
  function prepare(sql: string) {
    const upper = sql.trimStart().toUpperCase()
    const isSelect = upper.startsWith('SELECT')
    // releaseAiUsage: UPDATE ... SET count = MAX(0, count - 1) — floors at 0.
    const isRelease = upper.startsWith('UPDATE')

    return {
      bind(...values: unknown[]) {
        const ownerId = values[0] as string
        const day = values[1] as string
        const key = `${ownerId}::${day}`

        function applyWrite() {
          if (isRelease) {
            store.set(key, Math.max(0, (store.get(key) ?? 0) - 1))
          } else {
            // INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
            store.set(key, (store.get(key) ?? 0) + 1)
          }
        }

        return {
          async first<T>() {
            if (isSelect) {
              const count = store.get(key)
              if (count == null) return null
              return { count } as unknown as T
            }
            // reserveAiUsage: INSERT ... RETURNING count
            applyWrite()
            return { count: store.get(key) } as unknown as T
          },
          async run() {
            if (!isSelect) applyWrite()
            return { success: true, results: [], meta: {} }
          },
        }
      },
    }
  }

  return { prepare }
}

/**
 * In-memory D1 fake for the monthly spend table (`ai_usage_monthly`). Keyed by
 * "owner_id::month" → cumulative `spent_usd`. Unlike {@link makeFakeD1}'s daily
 * counter (always +1), `addAiSpend`'s INSERT carries the actual USD amount as
 * a bind param, so `run()` adds that amount rather than a fixed increment.
 *
 * `ensureMonthlyTable`'s `CREATE TABLE IF NOT EXISTS` runs with no `.bind()`
 * call at all, so `prepare()` exposes `run()` directly (real D1 statements
 * support calling `.run()`/`.first()` without binding when there are no
 * placeholders) in addition to the bound-statement shape the SELECT/INSERT use.
 */
function makeFakeSpendD1(store: Map<string, number>) {
  function prepare(sql: string) {
    const isSelect = sql.trimStart().toUpperCase().startsWith('SELECT')

    return {
      // CREATE TABLE IF NOT EXISTS — no bind, always a no-op success.
      async run() {
        return { success: true, results: [], meta: {} }
      },
      bind(...values: unknown[]) {
        const ownerId = values[0] as string
        const month = values[1] as string
        const amountUsd = values[2] as number | undefined
        const key = `${ownerId}::${month}`

        return {
          async first<T>() {
            if (!isSelect) return null
            const spent = store.get(key)
            if (spent == null) return null
            return { spent_usd: spent } as unknown as T
          },
          async run() {
            if (!isSelect && amountUsd != null) {
              store.set(key, (store.get(key) ?? 0) + amountUsd)
            }
            return { success: true, results: [], meta: {} }
          },
        }
      },
    }
  }

  return { prepare }
}

// ---------------------------------------------------------------------------
// Inject via mocked platform (must happen before any import of the SUT)
// ---------------------------------------------------------------------------

let currentDb:
  | ReturnType<typeof makeFakeD1>
  | ReturnType<typeof makeFakeSpendD1>
  | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
    getDurableObjectNamespace: () => null,
  }),
}))

// Dynamic import so the mock is already in place when the module initialises.
const {
  utcDayKey,
  getAiUsageToday,
  incrementAiUsage,
  reserveAiUsage,
  releaseAiUsage,
  getAiSpendThisMonth,
  meterAiOverage,
} = await import('./ai-usage-store')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2025-03-15T10:30:00Z')

describe('utcDayKey (pure)', () => {
  test('formats a known UTC date correctly', () => {
    expect(utcDayKey(new Date('2025-01-01T00:00:00Z'))).toBe('2025-01-01')
    expect(utcDayKey(new Date('2025-12-31T23:59:59Z'))).toBe('2025-12-31')
    expect(utcDayKey(new Date('2025-03-15T10:30:00Z'))).toBe('2025-03-15')
  })

  test('returns the current UTC date when called without args', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(utcDayKey()).toBe(today)
  })
})

describe('getAiUsageToday', () => {
  beforeEach(() => {
    currentDb = makeFakeD1(new Map())
  })

  test('returns 0 when no row exists', async () => {
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(0)
  })

  test('returns 0 when D1 binding is unavailable', async () => {
    currentDb = null
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(0)
  })
})

describe('incrementAiUsage + getAiUsageToday round-trip', () => {
  let store: UsageStore

  beforeEach(() => {
    store = new Map()
    currentDb = makeFakeD1(store)
  })

  test('count goes 0 → 1 after a single increment', async () => {
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(0)
    await incrementAiUsage('user_abc', FIXED_DATE)
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(1)
  })

  test('count accumulates across multiple increments', async () => {
    for (let i = 0; i < 5; i++) {
      await incrementAiUsage('user_xyz', FIXED_DATE)
    }
    expect(await getAiUsageToday('user_xyz', FIXED_DATE)).toBe(5)
  })

  test('different owners are isolated', async () => {
    await incrementAiUsage('user_a', FIXED_DATE)
    await incrementAiUsage('user_a', FIXED_DATE)
    await incrementAiUsage('user_b', FIXED_DATE)

    expect(await getAiUsageToday('user_a', FIXED_DATE)).toBe(2)
    expect(await getAiUsageToday('user_b', FIXED_DATE)).toBe(1)
  })

  test('different days are isolated for the same owner', async () => {
    const day1 = new Date('2025-03-14T10:00:00Z')
    const day2 = new Date('2025-03-15T10:00:00Z')

    await incrementAiUsage('user_abc', day1)
    await incrementAiUsage('user_abc', day1)
    await incrementAiUsage('user_abc', day2)

    expect(await getAiUsageToday('user_abc', day1)).toBe(2)
    expect(await getAiUsageToday('user_abc', day2)).toBe(1)
  })

  test('increment is a no-op when D1 binding is unavailable', async () => {
    currentDb = null
    // Must not throw
    await incrementAiUsage('user_abc', FIXED_DATE)
  })
})

describe('reserveAiUsage + releaseAiUsage lifecycle', () => {
  let store: UsageStore

  beforeEach(() => {
    store = new Map()
    currentDb = makeFakeD1(store)
  })

  test('reserve returns the post-increment count', async () => {
    expect(await reserveAiUsage('user_abc', FIXED_DATE)).toBe(1)
    expect(await reserveAiUsage('user_abc', FIXED_DATE)).toBe(2)
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(2)
  })

  test('reserve returns null when D1 is unavailable (self-hosted skips gating)', async () => {
    currentDb = null
    expect(await reserveAiUsage('user_abc', FIXED_DATE)).toBeNull()
  })

  test('release rolls back a reservation (aborted request consumes no quota)', async () => {
    await reserveAiUsage('user_abc', FIXED_DATE)
    await releaseAiUsage('user_abc', FIXED_DATE)
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(0)
  })

  test('release floors at 0 — a double release never over-refunds below zero', async () => {
    // Simulates the leak-fix guard's worst case: a failure observed by BOTH the
    // inner execute catch and the onError callback. The store floors at 0 so the
    // counter cannot go negative even if the release-once guard were bypassed.
    await reserveAiUsage('user_abc', FIXED_DATE)
    await releaseAiUsage('user_abc', FIXED_DATE)
    await releaseAiUsage('user_abc', FIXED_DATE)
    expect(await getAiUsageToday('user_abc', FIXED_DATE)).toBe(0)
  })

  test('release is a no-op when D1 is unavailable', async () => {
    currentDb = null
    await expect(
      releaseAiUsage('user_abc', FIXED_DATE)
    ).resolves.toBeUndefined()
  })
})

describe('meterAiOverage', () => {
  beforeEach(() => {
    currentDb = makeFakeSpendD1(new Map())
  })

  test('Free hard-caps: no overage is ever written (daily gate already blocks abuse)', async () => {
    await meterAiOverage(BILLING_PLANS.free, 'user_free', 0.1, FIXED_DATE)
    expect(await getAiSpendThisMonth('user_free', FIXED_DATE)).toBe(0)
  })

  test('Pro meters: cost accrues across calls', async () => {
    await meterAiOverage(BILLING_PLANS.pro, 'user_pro', 0.1, FIXED_DATE)
    expect(await getAiSpendThisMonth('user_pro', FIXED_DATE)).toBeCloseTo(0.1)

    await meterAiOverage(BILLING_PLANS.pro, 'user_pro', 0.1, FIXED_DATE)
    expect(await getAiSpendThisMonth('user_pro', FIXED_DATE)).toBeCloseTo(0.2)
  })

  test('fail-open: does not throw when D1 is unavailable', async () => {
    currentDb = null
    await expect(
      meterAiOverage(BILLING_PLANS.pro, 'user_pro', 0.1, FIXED_DATE)
    ).resolves.toBeUndefined()
  })
})
