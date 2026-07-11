import type { InsightCard } from './types'

import {
  dismissAllInsights,
  dismissInsight,
  filterActiveInsights,
  getDismissedInsights,
  isInsightDismissed,
} from './dismissed-insights'
import {
  insightKey,
  POSTGRES_INSIGHT_STORE_HOST_OFFSET,
  pgInsightStoreHostId,
} from './types'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// ── In-memory localStorage + window shim (bun has no DOM by default) ──
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) {
    return this.store.has(k) ? (this.store.get(k) as string) : null
  }
  setItem(k: string, v: string) {
    this.store.set(k, String(v))
  }
  removeItem(k: string) {
    this.store.delete(k)
  }
  clear() {
    this.store.clear()
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = globalThis
})
afterEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
  ;(globalThis as { window?: unknown }).window = undefined
})

const card = (over: Partial<InsightCard> = {}): InsightCard => ({
  severity: 'warning',
  category: 'anomaly',
  title: 'Error rate climbing',
  detail: 'detail',
  metric: 'error_rate',
  key: insightKey(0, {
    category: 'anomaly',
    metric: 'error_rate',
    title: 'Error rate climbing',
  }),
  ...over,
})

describe('insightKey', () => {
  test('is stable for the same host/category/metric/title', () => {
    const a = insightKey(0, {
      category: 'storage',
      metric: 'max_active_parts',
      title: 'X is fragmented',
    })
    const b = insightKey(0, {
      category: 'storage',
      metric: 'max_active_parts',
      title: 'X is fragmented',
    })
    expect(a).toBe(b)
  })

  test('differs across hosts and metrics', () => {
    const base = { category: 'anomaly', metric: 'error_rate', title: 'T' }
    expect(insightKey(0, base)).not.toBe(insightKey(1, base))
    expect(insightKey(0, base)).not.toBe(
      insightKey(0, { ...base, metric: 'memory_usage' })
    )
  })

  test('tolerates a missing metric', () => {
    expect(insightKey(0, { category: 'c', title: 't' })).toBe('0:c::t')
  })

  test('ClickHouse keys stay byte-identical when engine is defaulted/explicit', () => {
    const cand = { category: 'storage', metric: 'm', title: 't' }
    // Historical (2-arg) call and the explicit clickhouse engine must match, so
    // existing dismissals never break.
    expect(insightKey(3, cand)).toBe('3:storage:m:t')
    expect(insightKey(3, cand, 'clickhouse')).toBe('3:storage:m:t')
  })
})

describe('Postgres insight namespacing', () => {
  test('postgres keys are engine-prefixed and readable', () => {
    const cand = {
      category: 'performance',
      metric: 'pg_cache_hit_ratio',
      title: 'X',
    }
    expect(insightKey(0, cand, 'postgres')).toBe(
      'pg:0:performance:pg_cache_hit_ratio:X'
    )
  })

  test('a postgres key never collides with a clickhouse key at the same id', () => {
    const cand = { category: 'performance', metric: 'm', title: 't' }
    expect(insightKey(0, cand, 'postgres')).not.toBe(
      insightKey(0, cand, 'clickhouse')
    )
  })

  test('store host offset partitions postgres away from CH + D1 id spaces', () => {
    // CH env hosts are small non-negative indices; D1 user connections are
    // negative. The offset keeps every pgHostId disjoint from both.
    expect(pgInsightStoreHostId(0)).toBe(POSTGRES_INSIGHT_STORE_HOST_OFFSET)
    expect(pgInsightStoreHostId(5)).toBe(POSTGRES_INSIGHT_STORE_HOST_OFFSET + 5)
    expect(pgInsightStoreHostId(0)).toBeGreaterThan(1000) // > any realistic CH host
    expect(pgInsightStoreHostId(0)).toBeGreaterThan(0) // never negative (D1 space)
  })
})

describe('dismissed insights', () => {
  test('dismiss hides a single insight and persists', () => {
    const c = card()
    expect(isInsightDismissed(c.key)).toBe(false)
    dismissInsight(c)
    expect(isInsightDismissed(c.key)).toBe(true)
    expect(getDismissedInsights().has(c.key)).toBe(true)
  })

  test('filterActiveInsights drops dismissed cards only', () => {
    const a = card({ key: 'k:a' })
    const b = card({ key: 'k:b', title: 'Other' })
    dismissInsight(a)
    const active = filterActiveInsights([a, b])
    expect(active).toHaveLength(1)
    expect(active[0].key).toBe('k:b')
  })

  test('dismissAll hides every provided insight', () => {
    const a = card({ key: 'k:a' })
    const b = card({ key: 'k:b' })
    dismissAllInsights([a, b])
    expect(filterActiveInsights([a, b])).toHaveLength(0)
  })
})
