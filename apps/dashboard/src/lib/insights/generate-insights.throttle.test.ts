/**
 * Server-side regeneration throttle (issue #2179).
 *
 * The collect pipeline runs ~10 ClickHouse scans per call and is triggered both
 * per host/session and on every manual Refresh. `generateInsights` must skip the
 * scans and return the stored insights when the store already holds a finding
 * newer than INSIGHTS_MIN_REGEN_INTERVAL_MS — unless the caller forces a refresh.
 *
 * We assert this against the in-memory backend by counting how often the (mocked)
 * collector runs: a second generate within the window must NOT re-collect, while
 * force=true must.
 *
 * `generate-insights` is imported dynamically (after the mocks are registered) so
 * its static graph — which reaches the AI SDK enrich provider — is never linked;
 * the throttle behavior needs neither ClickHouse nor an LLM provider.
 */

import type { InsightCandidate } from './types'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// clickhouse-store is statically imported by the store resolver; stub the
// virtual cloudflare:workers env so the store graph loads without a runtime.
mock.module('cloudflare:workers', () => ({ env: {} }))

// Count collector invocations. The collector is the expensive ~10-scan step the
// throttle is meant to avoid, so its call count is the observable signal.
let collectCalls = 0
const CANDIDATE: InsightCandidate = {
  severity: 'warning',
  category: 'storage',
  title: 'table X is fragmented',
  detail: 'consider OPTIMIZE',
  metric: 'max_active_parts',
  value: 318,
}
mock.module('./collectors', () => ({
  collectInsights: async (): Promise<InsightCandidate[]> => {
    collectCalls += 1
    return [CANDIDATE]
  },
}))
// Enrichment is out of scope here — pass candidates through unchanged so the
// real llm-enrich module (and its AI provider dependency) is never loaded.
mock.module('./llm-enrich', () => ({
  enrichInsights: async (candidates: InsightCandidate[]) => candidates,
}))

// Deferred imports — resolved after the mocks above are registered.
type GenerateModule = typeof import('./generate-insights')
type StoreModule = typeof import('./store/resolve-store')
let generateInsights: GenerateModule['generateInsights']
let resetInsightsStoreCache: StoreModule['resetInsightsStoreCache']
let resolveInsightsStore: StoreModule['resolveInsightsStore']

const saved = process.env.INSIGHTS_STORE_BACKEND

beforeEach(async () => {
  process.env.INSIGHTS_STORE_BACKEND = 'memory'
  ;({ generateInsights } = await import('./generate-insights'))
  ;({ resetInsightsStoreCache, resolveInsightsStore } = await import(
    './store/resolve-store'
  ))
  resetInsightsStoreCache()
  collectCalls = 0
})

afterAll(() => {
  if (saved === undefined) delete process.env.INSIGHTS_STORE_BACKEND
  else process.env.INSIGHTS_STORE_BACKEND = saved
  resetInsightsStoreCache?.()
})

describe('generateInsights min-interval throttle', () => {
  test('a second generate within the window returns cached, no re-collect', async () => {
    const store = await resolveInsightsStore()
    expect(store.backend).toBe('memory')

    const first = await generateInsights(0, { enrich: false })
    expect(first).toHaveLength(1)
    expect(collectCalls).toBe(1)

    // Immediate second call: within INSIGHTS_MIN_REGEN_INTERVAL_MS, so the
    // pipeline is skipped and the stored insight is returned unchanged.
    const second = await generateInsights(0, { enrich: false })
    expect(collectCalls).toBe(1) // NOT re-collected
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({
      title: 'table X is fragmented',
      metric: 'max_active_parts',
    })
  })

  test('force=true bypasses the throttle and re-collects', async () => {
    await generateInsights(0, { enrich: false })
    expect(collectCalls).toBe(1)

    const forced = await generateInsights(0, { enrich: false, force: true })
    expect(collectCalls).toBe(2) // forced re-collection
    expect(forced).toHaveLength(1)
  })

  test('a different host is not throttled by another host', async () => {
    await generateInsights(0, { enrich: false })
    expect(collectCalls).toBe(1)

    // Host 1 has no stored insights yet → must collect even without force.
    await generateInsights(1, { enrich: false })
    expect(collectCalls).toBe(2)
  })
})
