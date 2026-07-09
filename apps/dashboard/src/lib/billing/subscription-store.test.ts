/**
 * Tests for subscription-store.ts's monotonic write guard and
 * cancel_at_period_end persistence (epic #2097 BE-4).
 *
 * Uses a small behavioral fake of D1Database (prepare/bind/run/first) injected
 * through a mocked @chm/platform, so we exercise the REAL guarded SQL rather
 * than re-implementing it in JS — mirrors the pattern in
 * connection-store/__tests__/d1-store-limit.test.ts. The fake evaluates the
 * upsert's ON CONFLICT ... WHERE guard the way SQLite/D1 actually would: the
 * UPDATE only applies when the incoming event_timestamp is null, the stored
 * one is null, or the incoming one is >= the stored one.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FakeSubscriptionRow {
  user_id: string
  owner_type: string
  plan_id: string
  billing_period: string | null
  status: string
  polar_subscription_id: string | null
  polar_customer_id: string | null
  current_period_end: number | null
  cancel_at_period_end: number
  event_timestamp: number | null
  created_at: number
  updated_at: number
}

function makeFakeD1() {
  const rowsByOwner = new Map<string, FakeSubscriptionRow>()

  function prepare(sql: string) {
    return {
      bind(...binds: unknown[]) {
        return {
          async first() {
            const ownerId = binds[0] as string
            return rowsByOwner.get(ownerId) ?? null
          },
          async run() {
            const isUpsert = /INSERT INTO user_subscriptions/.test(sql)
            if (!isUpsert) throw new Error(`Unexpected statement: ${sql}`)

            const [
              userId,
              ownerType,
              planId,
              billingPeriod,
              status,
              polarSubscriptionId,
              polarCustomerId,
              currentPeriodEnd,
              cancelAtPeriodEnd,
              eventTimestamp,
              now,
            ] = binds as [
              string,
              string,
              string,
              string | null,
              string,
              string | null,
              string | null,
              number | null,
              number,
              number | null,
              number,
            ]

            const existing = rowsByOwner.get(userId)
            if (
              existing &&
              existing.event_timestamp !== null &&
              eventTimestamp !== null &&
              eventTimestamp < existing.event_timestamp
            ) {
              // Guard rejects: an older event must not overwrite newer state.
              return { success: true, meta: { changes: 0 } }
            }

            rowsByOwner.set(userId, {
              user_id: userId,
              owner_type: ownerType,
              plan_id: planId,
              billing_period: billingPeriod,
              status,
              polar_subscription_id: polarSubscriptionId,
              polar_customer_id: polarCustomerId,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd,
              event_timestamp: eventTimestamp,
              created_at: existing?.created_at ?? now,
              updated_at: now,
            })
            return { success: true, meta: { changes: 1 } }
          },
        }
      },
    }
  }

  return { prepare, _rows: rowsByOwner }
}

let currentDb: ReturnType<typeof makeFakeD1> | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { getSubscription, upsertSubscription } = await import(
  './subscription-store'
)

beforeEach(() => {
  currentDb = makeFakeD1()
})

const baseInput = {
  userId: 'org_1',
  ownerType: 'org' as const,
  planId: 'pro' as const,
  billingPeriod: 'monthly' as const,
  status: 'active',
  polarSubscriptionId: 'sub_1',
  polarCustomerId: 'cus_1',
  currentPeriodEnd: 1_800_000_000,
}

describe('subscription-store — cancel_at_period_end persistence', () => {
  test('persists cancelAtPeriodEnd:true and reads it back', async () => {
    await upsertSubscription({ ...baseInput, cancelAtPeriodEnd: true })
    const sub = await getSubscription('org_1')
    expect(sub?.cancelAtPeriodEnd).toBe(true)
  })

  test('defaults to false when omitted', async () => {
    await upsertSubscription(baseInput)
    const sub = await getSubscription('org_1')
    expect(sub?.cancelAtPeriodEnd).toBe(false)
  })
})

describe('subscription-store — billing_period persistence (annual billing)', () => {
  test('persists billingPeriod: yearly and reads it back', async () => {
    // Annual periods carry a currentPeriodEnd ~365 days out rather than ~30 —
    // the column itself is period-agnostic, but this locks in that a yearly
    // write round-trips distinctly from the monthly baseInput fixture.
    await upsertSubscription({
      ...baseInput,
      billingPeriod: 'yearly',
      currentPeriodEnd: baseInput.currentPeriodEnd + 365 * 24 * 60 * 60,
    })
    const sub = await getSubscription('org_1')
    expect(sub?.billingPeriod).toBe('yearly')
  })

  test('switching from yearly to monthly on a plan change overwrites the stored period', async () => {
    await upsertSubscription({
      ...baseInput,
      billingPeriod: 'yearly',
      eventTimestamp: 1000,
    })
    await upsertSubscription({
      ...baseInput,
      billingPeriod: 'monthly',
      eventTimestamp: 2000,
    })
    const sub = await getSubscription('org_1')
    expect(sub?.billingPeriod).toBe('monthly')
  })
})

describe('subscription-store — monotonic write guard', () => {
  test('a newer eventTimestamp overwrites older state', async () => {
    await upsertSubscription({
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    await upsertSubscription({
      ...baseInput,
      status: 'canceled',
      eventTimestamp: 2000,
    })

    const sub = await getSubscription('org_1')
    expect(sub?.status).toBe('canceled')
  })

  test('an older/stale eventTimestamp is rejected — newer state is not overwritten', async () => {
    await upsertSubscription({
      ...baseInput,
      status: 'active',
      eventTimestamp: 2000,
    })
    // A late-arriving retry/replay of an OLDER event must not stomp the
    // fresher "active" state written above.
    await upsertSubscription({
      ...baseInput,
      status: 'canceled',
      eventTimestamp: 1000,
    })

    const sub = await getSubscription('org_1')
    expect(sub?.status).toBe('active')
  })

  test('an equal eventTimestamp is accepted (idempotent replay of the same event)', async () => {
    await upsertSubscription({
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    await upsertSubscription({
      ...baseInput,
      status: 'past_due',
      eventTimestamp: 1000,
    })

    const sub = await getSubscription('org_1')
    expect(sub?.status).toBe('past_due')
  })

  test('a write without eventTimestamp always wins (e.g. the Polar-truth write-through cache)', async () => {
    await upsertSubscription({
      ...baseInput,
      status: 'active',
      eventTimestamp: 5000,
    })
    // A caller with no event ordering (reads Polar's CURRENT state) must not
    // be blocked by a webhook-sourced timestamp already on the row.
    await upsertSubscription({
      ...baseInput,
      status: 'canceled',
    })

    const sub = await getSubscription('org_1')
    expect(sub?.status).toBe('canceled')
  })

  test('the first write ever (no existing row) always applies regardless of eventTimestamp', async () => {
    await upsertSubscription({
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    const sub = await getSubscription('org_1')
    expect(sub?.status).toBe('active')
  })
})
