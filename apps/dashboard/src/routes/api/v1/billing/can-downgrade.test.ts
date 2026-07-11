/**
 * Tests for POST /api/v1/billing/can-downgrade (plans/19-downgrade-protection.md).
 *
 * Every mocked specifier carries its full real export surface (not just what
 * this file uses) per the established convention in checkout.test.ts /
 * webhooks/polar.test.ts: bun's mock.module() registers per specifier, and a
 * superset keeps registration order-independent when CI runs
 * `bun test src/ --isolate`. `@/lib/billing/owner-usage` is mocked at its LEAF
 * specifier so hosts/seats usage can be set per test without touching Clerk,
 * D1, or the connection store. `@/lib/billing/plans` is NOT mocked — real
 * `@chm/pricing` plan data drives the Free/Pro/Max comparisons, matching the
 * plan's Free→Pro / Max→Pro test cases.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { getPlan } from '@/lib/billing/plans'

let resolveBillingOwner = mock(async () => ({
  type: 'user' as const,
  id: 'user_1',
}))
// Superset mock: exports the FULL real surface of billing-owner.ts (both
// resolveBillingOwner and resolveBillingOwnerId). checkout.test.ts also mocks
// this specifier (with resolveBillingOwnerId); under a single-process
// `bun test` run the last registration wins, so an incomplete mock here would
// leave checkout.ts unable to resolve resolveBillingOwnerId. A superset keeps
// the combined run order-independent (see docs/knowledge/billing-checkout-flow.md
// on mock.module contamination).
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
  resolveBillingOwnerId: async () => (await resolveBillingOwner()).id,
}))

let resolveConnectionUserId = mock(async () => 'user_1')
mock.module('@/lib/connection-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveConnectionUserId: () => resolveConnectionUserId(),
}))

interface OwnerUsageFixture {
  plan: ReturnType<typeof getPlan>
  hostsUsed: number
  seatsUsed: number
  aiUsedToday: number
  aiSpentThisMonth: number
}

let ownerUsage: OwnerUsageFixture = {
  plan: getPlan('free'),
  hostsUsed: 0,
  seatsUsed: 1,
  aiUsedToday: 0,
  aiSpentThisMonth: 0,
}
let resolveOwnerUsage = mock(async () => ownerUsage)
mock.module('@/lib/billing/owner-usage', () => ({
  resolveOwnerUsage: () => resolveOwnerUsage(),
}))

// A mutable enforcement registry so one test can flip a metric to `deferred`
// without touching the real plan-enforcement.ts registry or its own test file.
const enforcementRegistry: Record<string, { status: string; note: string }> = {
  hosts: { status: 'enforced', note: 'test' },
  seats: { status: 'enforced', note: 'test' },
  alertRules: { status: 'deferred', note: 'test' },
  retentionDays: { status: 'enforced', note: 'test' },
  aiRequestsPerDay: { status: 'enforced', note: 'test' },
  aiMonthlyUsdBudget: { status: 'enforced', note: 'test' },
}
mock.module('@/lib/billing/plan-enforcement', () => ({
  LIMIT_ENFORCEMENT: enforcementRegistry,
}))

const { __handlePostForTests: handlePost } = await import('./can-downgrade')

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://dash.example.com/api/v1/billing/can-downgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface ExceededLimit {
  metric: string
  used: number
  targetLimit: number | null
  message: string
}

async function readOk(res: Response): Promise<{
  ok: boolean
  exceeded: ExceededLimit[]
}> {
  const json = (await res.json()) as {
    success: boolean
    data: { ok: boolean; exceeded: ExceededLimit[] }
  }
  expect(json.success).toBe(true)
  return json.data
}

beforeEach(() => {
  resolveBillingOwner = mock(async () => ({
    type: 'user' as const,
    id: 'user_1',
  }))
  resolveConnectionUserId = mock(async () => 'user_1')
  ownerUsage = {
    plan: getPlan('free'),
    hostsUsed: 0,
    seatsUsed: 1,
    aiUsedToday: 0,
    aiSpentThisMonth: 0,
  }
  resolveOwnerUsage = mock(async () => ownerUsage)
  enforcementRegistry.hosts = { status: 'enforced', note: 'test' }
  enforcementRegistry.seats = { status: 'enforced', note: 'test' }
})

describe('POST /api/v1/billing/can-downgrade', () => {
  test('Free→Pro (upgrade-direction target) is ok with no exceeded limits', async () => {
    ownerUsage = {
      plan: getPlan('free'),
      hostsUsed: 1,
      seatsUsed: 1,
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'pro' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(true)
    expect(exceeded).toEqual([])
  })

  test('Max→Pro with 5 hosts (Pro soft-caps hosts via hostOverage) does NOT report hosts exceeded', async () => {
    // Pro publishes `hostOverage` (soft cap): `checkHostSoftCap` never blocks
    // a plan with an overage policy — it meters billable overage instead.
    // Warning "hosts exceeded" here would be the same dishonest-paywall shape
    // this route explicitly avoids for `aiRequestsPerDay` — nothing is lost.
    ownerUsage = {
      plan: getPlan('max'),
      hostsUsed: 5,
      seatsUsed: 2,
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'pro' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(true)
    expect(exceeded).toEqual([])
  })

  test('Pro→Free with 3 hosts (Free hard-caps at 1, hostOverage: null) reports hosts exceeded', async () => {
    ownerUsage = {
      plan: getPlan('pro'),
      hostsUsed: 3,
      seatsUsed: 1,
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'free' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(false)
    expect(exceeded).toContainEqual(
      expect.objectContaining({ metric: 'hosts', used: 3, targetLimit: 1 })
    )
  })

  test('seats over the target plan appear in exceeded', async () => {
    ownerUsage = {
      plan: getPlan('max'),
      hostsUsed: 2,
      seatsUsed: 5,
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'pro' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(false)
    expect(exceeded).toContainEqual(
      expect.objectContaining({ metric: 'seats', used: 5, targetLimit: 3 })
    )
  })

  test('a deferred metric never appears in exceeded even when numerically over', async () => {
    // Target Free (hard-capped) so this exercises the enforcement-status
    // branch specifically — Pro/Max targets already skip `hosts` regardless
    // of enforcement status because they soft-cap via `hostOverage`.
    enforcementRegistry.hosts = { status: 'deferred', note: 'beta' }
    ownerUsage = {
      plan: getPlan('pro'),
      hostsUsed: 3, // over Free's 1-host cap
      seatsUsed: 1, // within Free's 1-seat cap
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'free' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(true)
    expect(exceeded).toEqual([])
  })

  test('exact-fit usage (used === targetLimit) is not exceeded', async () => {
    ownerUsage = {
      plan: getPlan('max'),
      hostsUsed: 1, // exactly Pro's cap — fits, should not warn
      seatsUsed: 3,
      aiUsedToday: 0,
      aiSpentThisMonth: 0,
    }

    const res = await handlePost(makeRequest({ targetPlanId: 'pro' }))
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(true)
    expect(exceeded).toEqual([])
  })

  test('fail-open: owner resolution failure (no Clerk / OSS) returns ok with no throw', async () => {
    resolveBillingOwner = mock(async () => {
      throw new Error('Authentication is required for billing.')
    })

    const res = await handlePost(makeRequest({ targetPlanId: 'pro' }))
    expect(res.status).toBe(200)
    const { ok, exceeded } = await readOk(res)
    expect(ok).toBe(true)
    expect(exceeded).toEqual([])
  })

  test('an unknown targetPlanId 400s and never resolves usage', async () => {
    const res = await handlePost(makeRequest({ targetPlanId: 'nope' }))
    expect(res.status).toBe(400)
    expect(resolveOwnerUsage).not.toHaveBeenCalled()
  })
})
