/**
 * Tests for the query advisor route's AI-usage metering (BE gap flagged in
 * review of plans/46-query-advisor-engine.md): `reserveAdvisorUsage()` /
 * `releaseAdvisorUsage()` gate `runAdvisor()` exactly like
 * routes/api/v1/agent.ts's enforcement block, but had no coverage of its own.
 *
 * Mirrors the mock.module style in routes/api/v1/health/webhook.test.ts and
 * routes/api/v1/webhooks/polar.test.ts: billing collaborators (owner
 * resolution, plan lookup, D1-backed usage store) are mocked so this stays a
 * pure unit test; `@/lib/billing/entitlements` is left real (pure, no I/O) so
 * the actual `checkAiDailyLimit`/`limitMessage` business logic is exercised,
 * not just the wiring around it. `analyzeQuery` is mocked to isolate the
 * billing gate from the recommendation engine itself (covered separately by
 * src/lib/ai/advisor/__tests__/analyze-query.test.ts). Each mocked export is a
 * stable wrapper delegating to a per-test `let` binding so a test can
 * reassign behavior mid-file. `runAdvisor` is imported via the
 * `__runAdvisorForTests` re-export (same convention as
 * `__handlePostForTests` / `__applySubscriptionForTests`) — it needs no
 * `cloudflare:workers` env, since only the GET/POST handlers touch `env` —
 * but importing the module still evaluates its top-level `import { env }
 * from 'cloudflare:workers'`, so that specifier is stubbed too (mirrors
 * routes/api/v1/__tests__/actions.test.ts).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { getPlan } from '@/lib/billing/plans'

mock.module('cloudflare:workers', () => ({ env: {} }))

let resolveBillingOwner = mock(
  async (): Promise<{ id: string }> => ({
    id: 'user_1',
  })
)
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
}))

let getPlanForOwner = mock(async (_ownerId: string) => getPlan('free'))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: (ownerId: string) => getPlanForOwner(ownerId),
}))

let reserveAiUsage = mock(async (_ownerId: string): Promise<number | null> => 1)
let releaseAiUsage = mock(async (_ownerId: string): Promise<void> => {})
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage: (ownerId: string) => reserveAiUsage(ownerId),
  releaseAiUsage: (ownerId: string) => releaseAiUsage(ownerId),
}))

let analyzeQuery = mock(async (_input: unknown) => ({
  ok: true as const,
  type: 'query_advisor_recommendations' as const,
  sql: 'SELECT 1',
  database: 'default',
  table: 'events',
  recommendations: [],
  notes: [],
}))
mock.module('@/lib/ai/advisor/recommendation-engine', () => ({
  analyzeQuery: (input: unknown) => analyzeQuery(input),
}))

const { __runAdvisorForTests: runAdvisor } = await import('./advisor')

beforeEach(() => {
  resolveBillingOwner = mock(async () => ({ id: 'user_1' }))
  getPlanForOwner = mock(async () => getPlan('free'))
  reserveAiUsage = mock(async () => 1)
  releaseAiUsage = mock(async () => {})
  analyzeQuery = mock(async () => ({
    ok: true as const,
    type: 'query_advisor_recommendations' as const,
    sql: 'SELECT 1',
    database: 'default',
    table: 'events',
    recommendations: [],
    notes: [],
  }))
})

describe('advisor route — AI-usage metering gate', () => {
  test('over the daily allowance: 402, releases the reservation, never runs the engine', async () => {
    // free plan: aiRequestsPerDay = 5, hard cap (aiOverage: null). A
    // post-increment count of 6 means this would be the 6th request today.
    reserveAiUsage = mock(async () => 6)

    const res = await runAdvisor(0, 'SELECT 1', null, null)

    expect(res.status).toBe(402)
    const body = (await res.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('daily AI limit')
    expect(analyzeQuery).not.toHaveBeenCalled()
    // The reservation that pushed the count to 6 must be rolled back.
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage.mock.calls[0]?.[0]).toBe('user_1')
  })

  test('within the allowance: runs the engine, does not release the reservation', async () => {
    reserveAiUsage = mock(async () => 3)

    const res = await runAdvisor(0, 'SELECT 1', null, null)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)
    expect(analyzeQuery).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).not.toHaveBeenCalled()
  })

  test('engine throws: releases the reservation and reports 500, never swallows the error', async () => {
    reserveAiUsage = mock(async () => 2)
    analyzeQuery = mock(async () => {
      throw new Error('ClickHouse unreachable')
    })

    const res = await runAdvisor(0, 'SELECT 1', null, null)

    expect(res.status).toBe(500)
    const body = (await res.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('ClickHouse unreachable')
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
  })

  test('self-hosted / no Clerk owner: fails open, meters nothing, still runs the engine', async () => {
    resolveBillingOwner = mock(async () => {
      throw new Error('Authentication is required for billing.')
    })

    const res = await runAdvisor(0, 'SELECT 1', null, null)

    expect(res.status).toBe(200)
    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(analyzeQuery).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).not.toHaveBeenCalled()
  })

  test('enterprise-style unlimited plan (aiRequestsPerDay: null): never reserves, never blocks', async () => {
    getPlanForOwner = mock(async () => getPlan('enterprise'))

    const res = await runAdvisor(0, 'SELECT 1', null, null)

    expect(res.status).toBe(200)
    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(analyzeQuery).toHaveBeenCalledTimes(1)
  })
})
