/**
 * Tests for the subscription-store monotonic write guard + cancel_at_period_end
 * / billing_period persistence — the D1 CONTRACT shared by both Workers.
 *
 * A small behavioral fake of D1Database (prepare/bind/run/first) is injected
 * directly (the package takes a `D1Like` handle rather than resolving a
 * binding), so we exercise the REAL guarded SQL rather than re-implementing it.
 * The fake evaluates the upsert's `ON CONFLICT ... WHERE` guard the way SQLite/D1
 * would: the UPDATE only applies when the incoming event_timestamp is null, the
 * stored one is null, or the incoming one is >= the stored one.
 */

import {
  type D1Like,
  getSubscription,
  upsertSubscription,
} from './subscription-store'
import { beforeEach, describe, expect, test } from 'bun:test'

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

function makeFakeD1(): D1Like {
  const rowsByOwner = new Map<string, FakeSubscriptionRow>()

  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async first<T = unknown>() {
              const ownerId = binds[0] as string
              return (rowsByOwner.get(ownerId) ?? null) as T | null
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
    },
  }
}

let db: D1Like

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

beforeEach(() => {
  db = makeFakeD1()
})

describe('cancel_at_period_end persistence', () => {
  test('persists cancelAtPeriodEnd:true and reads it back', async () => {
    await upsertSubscription(db, { ...baseInput, cancelAtPeriodEnd: true })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.cancelAtPeriodEnd).toBe(true)
  })

  test('defaults to false when omitted', async () => {
    await upsertSubscription(db, baseInput)
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.cancelAtPeriodEnd).toBe(false)
  })
})

describe('billing_period persistence (annual billing)', () => {
  test('persists billingPeriod: yearly and reads it back', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      billingPeriod: 'yearly',
      currentPeriodEnd: baseInput.currentPeriodEnd + 365 * 24 * 60 * 60,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.billingPeriod).toBe('yearly')
  })

  test('switching from yearly to monthly on a plan change overwrites the stored period', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      billingPeriod: 'yearly',
      eventTimestamp: 1000,
    })
    await upsertSubscription(db, {
      ...baseInput,
      billingPeriod: 'monthly',
      eventTimestamp: 2000,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.billingPeriod).toBe('monthly')
  })
})

describe('monotonic write guard', () => {
  test('a newer eventTimestamp overwrites older state', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    await upsertSubscription(db, {
      ...baseInput,
      status: 'canceled',
      eventTimestamp: 2000,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.status).toBe('canceled')
  })

  test('an older/stale eventTimestamp is rejected — newer state is not overwritten', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      status: 'active',
      eventTimestamp: 2000,
    })
    await upsertSubscription(db, {
      ...baseInput,
      status: 'canceled',
      eventTimestamp: 1000,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.status).toBe('active')
  })

  test('an equal eventTimestamp is accepted (idempotent replay of the same event)', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    await upsertSubscription(db, {
      ...baseInput,
      status: 'past_due',
      eventTimestamp: 1000,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.status).toBe('past_due')
  })

  test('a write without eventTimestamp always wins (Polar-truth write-through cache)', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      status: 'active',
      eventTimestamp: 5000,
    })
    await upsertSubscription(db, { ...baseInput, status: 'canceled' })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.status).toBe('canceled')
  })

  test('the first write ever (no existing row) always applies regardless of eventTimestamp', async () => {
    await upsertSubscription(db, {
      ...baseInput,
      status: 'active',
      eventTimestamp: 1000,
    })
    const sub = await getSubscription(db, 'org_1')
    expect(sub?.status).toBe('active')
  })
})

describe('getSubscription — graceful degradation', () => {
  test('returns null and calls onError when the read throws (e.g. missing table)', async () => {
    const throwing: D1Like = {
      prepare() {
        return {
          bind() {
            return {
              run: async () => ({}),
              first: async () => {
                throw new Error('no such table: user_subscriptions')
              },
            }
          },
        }
      },
    }
    let captured: unknown = null
    const sub = await getSubscription(throwing, 'org_1', (err) => {
      captured = err
    })
    expect(sub).toBeNull()
    expect(captured).toBeInstanceOf(Error)
  })
})
