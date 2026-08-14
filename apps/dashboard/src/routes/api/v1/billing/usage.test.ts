/**
 * GET /api/v1/billing/usage — Cloud guest slim payload vs OSS 401.
 *
 * Superset mock of billing-owner so a combined `bun test` run stays
 * order-independent with checkout.test.ts / can-downgrade.test.ts.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@/lib/billing/plans'
import { ConversationStoreError } from '@/lib/conversation-store/types'

let cloudMode = false
mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => cloudMode,
  isCloudModeClient: () => cloudMode,
  parseCloudMode: (value: string | null | undefined) =>
    value === 'true' || value === '1' || value === 'cloud',
}))

const resolveBillingOwner = mock(async () => ({
  type: 'user' as const,
  id: 'user_1',
}))
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
  resolveBillingOwnerId: async () => (await resolveBillingOwner()).id,
}))

mock.module('@/lib/connection-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveConnectionUserId: async () => 'user_1',
}))

mock.module('@/lib/billing/owner-usage', () => ({
  resolveOwnerUsage: async () => ({
    plan: BILLING_PLANS.free,
    hostsUsed: 0,
    seatsUsed: 1,
    aiUsedToday: 1,
    aiSpentThisMonth: 0,
    hostOverageThisMonth: 0,
  }),
}))

mock.module('@/lib/billing/user-subscription', () => ({
  resolveOwnerSubscription: async () => null,
  getPlanForOwner: async () => BILLING_PLANS.free,
}))

let aiUsedToday = 1
mock.module('@/lib/billing/ai-usage-store', () => ({
  getAiUsageToday: async () => aiUsedToday,
  reserveAiUsage: async () => 1,
  releaseAiUsage: async () => {},
  incrementAiUsage: async () => {},
  getAiSpendThisMonth: async () => 0,
  addAiSpend: async () => {},
  recordByokActivation: async () => {},
  getByokActivationsThisMonth: async () => 0,
  meterAiOverage: async () => {},
  utcDayKey: () => '2026-08-14',
  utcMonthKey: () => '2026-08',
}))

const { __handleGetForTests: handleGet } = await import('./usage')

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/billing/usage', {
    method: 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.50' },
  })
}

function unauthorized(): never {
  throw new ConversationStoreError(
    'Authentication is required for billing.',
    'UNAUTHORIZED'
  )
}

beforeEach(() => {
  cloudMode = false
  aiUsedToday = 1
  resolveBillingOwner.mockReset()
  resolveBillingOwner.mockImplementation(async () => ({
    type: 'user' as const,
    id: 'user_1',
  }))
})

afterEach(() => {
  cloudMode = false
})

describe('GET /api/v1/billing/usage — guest vs OSS', () => {
  test('cloud guest: 200 with planId guest and aiMessages meter', async () => {
    cloudMode = true
    resolveBillingOwner.mockImplementation(unauthorized)
    aiUsedToday = 2

    const res = await handleGet(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: {
        planId: string
        planName: string
        aiMessages: { used: number; limit: number | null; unlimited: boolean }
      }
    }
    expect(body.success).toBe(true)
    expect(body.data.planId).toBe('guest')
    expect(body.data.planName).toBe('Guest')
    expect(body.data.aiMessages.used).toBe(2)
    expect(body.data.aiMessages.limit).toBe(3)
    expect(body.data.aiMessages.unlimited).toBe(false)
  })

  test('OSS unsigned: still 401', async () => {
    cloudMode = false
    resolveBillingOwner.mockImplementation(unauthorized)

    const res = await handleGet(makeRequest())
    expect(res.status).toBe(401)
  })
})
