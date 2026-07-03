/**
 * Unit tests for host-usage-store.ts
 *
 * Uses a minimal in-memory D1 fake injected via mock.module('@chm/platform')
 * — the same pattern as ai-usage-store.test.ts — so the store's real SQL is
 * exercised without requiring a Cloudflare Workers runtime.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ---------------------------------------------------------------------------
// In-memory D1 fake for the monthly host-overage table (`host_usage_monthly`).
// Keyed by "owner_id::month" → PEAK host_count. The store's INSERT carries the
// candidate overage count as a bind param and folds it with MAX() on conflict,
// so `run()` here mirrors that MAX semantics rather than a fixed increment.
// ---------------------------------------------------------------------------

function makeFakeD1(store: Map<string, number>) {
  function prepare(sql: string) {
    const isSelect = sql.trimStart().toUpperCase().startsWith('SELECT')

    return {
      bind(...values: unknown[]) {
        const ownerId = values[0] as string
        const month = values[1] as string
        const hostCount = values[2] as number | undefined
        const key = `${ownerId}::${month}`

        return {
          async first<T>() {
            if (!isSelect) return null
            const count = store.get(key)
            if (count == null) return null
            return { host_count: count } as unknown as T
          },
          async run() {
            if (!isSelect && hostCount != null) {
              store.set(key, Math.max(store.get(key) ?? 0, hostCount))
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

let currentDb: ReturnType<typeof makeFakeD1> | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
    getDurableObjectNamespace: () => null,
  }),
}))

// Dynamic import so the mock is already in place when the module initialises.
const { getHostOverageThisMonth, recordHostOverage } = await import(
  './host-usage-store'
)

const FIXED_DATE = new Date('2025-03-15T10:30:00Z')

describe('getHostOverageThisMonth', () => {
  beforeEach(() => {
    currentDb = makeFakeD1(new Map())
  })

  test('returns 0 when no row exists', async () => {
    expect(await getHostOverageThisMonth('user_abc', FIXED_DATE)).toBe(0)
  })

  test('returns 0 when D1 binding is unavailable', async () => {
    currentDb = null
    expect(await getHostOverageThisMonth('user_abc', FIXED_DATE)).toBe(0)
  })
})

describe('recordHostOverage — peak meter', () => {
  beforeEach(() => {
    currentDb = makeFakeD1(new Map())
  })

  test('records the first overage count', async () => {
    await recordHostOverage('user_pro', 1, FIXED_DATE)
    expect(await getHostOverageThisMonth('user_pro', FIXED_DATE)).toBe(1)
  })

  test('a higher later count raises the peak', async () => {
    await recordHostOverage('user_pro', 1, FIXED_DATE)
    await recordHostOverage('user_pro', 2, FIXED_DATE)
    expect(await getHostOverageThisMonth('user_pro', FIXED_DATE)).toBe(2)
  })

  test('a lower later count does NOT lower the peak (peak, not additive/current)', async () => {
    await recordHostOverage('user_pro', 1, FIXED_DATE)
    await recordHostOverage('user_pro', 2, FIXED_DATE)
    await recordHostOverage('user_pro', 1, FIXED_DATE)
    expect(await getHostOverageThisMonth('user_pro', FIXED_DATE)).toBe(2)
  })

  test('different owners are isolated', async () => {
    await recordHostOverage('user_a', 3, FIXED_DATE)
    await recordHostOverage('user_b', 1, FIXED_DATE)
    expect(await getHostOverageThisMonth('user_a', FIXED_DATE)).toBe(3)
    expect(await getHostOverageThisMonth('user_b', FIXED_DATE)).toBe(1)
  })

  test('different months are isolated for the same owner', async () => {
    const feb = new Date('2025-02-15T10:00:00Z')
    const mar = new Date('2025-03-15T10:00:00Z')
    await recordHostOverage('user_abc', 2, feb)
    await recordHostOverage('user_abc', 1, mar)
    expect(await getHostOverageThisMonth('user_abc', feb)).toBe(2)
    expect(await getHostOverageThisMonth('user_abc', mar)).toBe(1)
  })

  test('non-positive counts are ignored (no-op)', async () => {
    await recordHostOverage('user_abc', 0, FIXED_DATE)
    await recordHostOverage('user_abc', -1, FIXED_DATE)
    expect(await getHostOverageThisMonth('user_abc', FIXED_DATE)).toBe(0)
  })

  test('fail-open: does not throw when D1 is unavailable', async () => {
    currentDb = null
    await expect(
      recordHostOverage('user_abc', 2, FIXED_DATE)
    ).resolves.toBeUndefined()
    expect(await getHostOverageThisMonth('user_abc', FIXED_DATE)).toBe(0)
  })
})
