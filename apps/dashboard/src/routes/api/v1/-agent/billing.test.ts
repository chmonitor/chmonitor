/**
 * applyAiUsageGate — Cloud guest daily cap + signed-in / OSS skip paths.
 *
 * Mocks only the I/O boundaries (Clerk owner, D1 store, cloud-mode). The
 * entitlement helpers and guest-ai plan stay real so the 402 shape matches
 * production.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { ConversationStoreError } from '@/lib/conversation-store/types'

const OWNER_ID = 'user_signed_in'
const GUEST_ID = 'guest:abcdef0123456789'

let cloudMode = false
mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => cloudMode,
  isCloudModeClient: () => cloudMode,
  parseCloudMode: (value: string | null | undefined) =>
    value === 'true' || value === '1' || value === 'cloud',
}))

const resolveBillingOwner = mock(async () => ({
  type: 'user' as const,
  id: OWNER_ID,
}))
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
  resolveBillingOwnerId: async () => (await resolveBillingOwner()).id,
}))

const getPlanForOwner = mock(async (_ownerId?: string) => ({
  id: 'free',
  name: 'Free',
  aiRequestsPerDay: 5,
  aiMonthlyUsdBudget: null,
  aiOverage: null,
}))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: (ownerId?: string) => getPlanForOwner(ownerId),
  resolveOwnerSubscription: async () => null,
}))

let reserveResult: number | null = 1
const reserveAiUsage = mock(async (_ownerId?: string) => reserveResult)
const releaseAiUsage = mock(async (_ownerId?: string) => {})
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage: (ownerId?: string) => reserveAiUsage(ownerId),
  releaseAiUsage: (ownerId?: string) => releaseAiUsage(ownerId),
  getAiSpendThisMonth: async () => 0,
  getAiUsageToday: async () => 0,
  incrementAiUsage: async () => {},
  addAiSpend: async () => {},
  recordByokActivation: async () => {},
  getByokActivationsThisMonth: async () => 0,
  meterAiOverage: async () => {},
  utcDayKey: () => '2026-08-14',
  utcMonthKey: () => '2026-08',
}))

const { applyAiUsageGate } = await import('./billing')

function unauthorized(): never {
  throw new ConversationStoreError(
    'Authentication is required for billing.',
    'UNAUTHORIZED'
  )
}

beforeEach(() => {
  cloudMode = false
  reserveResult = 1
  resolveBillingOwner.mockReset()
  resolveBillingOwner.mockImplementation(async () => ({
    type: 'user' as const,
    id: OWNER_ID,
  }))
  getPlanForOwner.mockClear()
  reserveAiUsage.mockClear()
  releaseAiUsage.mockClear()
})

afterEach(() => {
  cloudMode = false
})

describe('applyAiUsageGate — cloud guest', () => {
  test('under the cap: allows and reserves against the guest owner id', async () => {
    cloudMode = true
    resolveBillingOwner.mockImplementation(unauthorized)
    reserveResult = 1

    const gate = await applyAiUsageGate(false, { guestOwnerId: GUEST_ID })

    expect(gate.ok).toBe(true)
    if (!gate.ok) return
    expect(gate.billingOwnerId).toBe(GUEST_ID)
    expect(gate.resolvedPlan?.name).toBe('Guest')
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledWith(GUEST_ID)
    expect(releaseAiUsage).not.toHaveBeenCalled()
  })

  test('over the cap: 402 guest_daily_limit and releases the reservation', async () => {
    cloudMode = true
    resolveBillingOwner.mockImplementation(unauthorized)
    // Default guest cap is 3; post-increment 4 means usage-before was 3.
    reserveResult = 4

    const gate = await applyAiUsageGate(false, { guestOwnerId: GUEST_ID })

    expect(gate.ok).toBe(false)
    if (gate.ok) return
    expect(gate.response.status).toBe(402)
    const body = (await gate.response.json()) as {
      error: string
      details: { reason: string; limit: number }
    }
    expect(body.details.reason).toBe('guest_daily_limit')
    expect(body.details.limit).toBe(3)
    expect(body.error).toContain('guest daily AI limit')
    expect(body.error.toLowerCase()).toContain('sign in')
    expect(body.error.toLowerCase()).not.toContain('polar')
    expect(reserveAiUsage).toHaveBeenCalledWith(GUEST_ID)
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledWith(GUEST_ID)
  })
})

describe('applyAiUsageGate — OSS guest skips', () => {
  test('no Clerk owner and not cloud: skips without reserving', async () => {
    cloudMode = false
    resolveBillingOwner.mockImplementation(unauthorized)

    const gate = await applyAiUsageGate(false, { guestOwnerId: GUEST_ID })

    expect(gate.ok).toBe(true)
    if (!gate.ok) return
    expect(gate.billingOwnerId).toBeNull()
    expect(gate.resolvedPlan).toBeNull()
    expect(reserveAiUsage).not.toHaveBeenCalled()
  })
})

describe('applyAiUsageGate — signed-in unchanged', () => {
  test('reserves against the Clerk owner, not a guest key', async () => {
    cloudMode = true
    reserveResult = 1

    const gate = await applyAiUsageGate(false, { guestOwnerId: GUEST_ID })

    expect(gate.ok).toBe(true)
    if (!gate.ok) return
    expect(gate.billingOwnerId).toBe(OWNER_ID)
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledWith(OWNER_ID)
    expect(getPlanForOwner).toHaveBeenCalledWith(OWNER_ID)
  })
})
