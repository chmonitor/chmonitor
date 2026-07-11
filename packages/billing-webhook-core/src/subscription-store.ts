/**
 * Subscription store — the D1 persistence CONTRACT for billing state, framework
 * agnostic so both the dashboard Worker and the cloud-hooks Worker can share it
 * without the SQL (and its monotonic write guard) forking between them.
 *
 * Instead of resolving a Cloudflare binding itself, every function takes a
 * minimal `D1Like` handle (`prepare(sql).bind(...).run()/first()`), which the
 * caller obtains from its own runtime (`getPlatformBindings().getD1Database(...)`
 * in the dashboard, `env.CHM_CLOUD_D1` in cloud-hooks). This keeps the package
 * dependency-free and lets a behavioural fake drive the REAL guarded SQL in
 * tests.
 *
 * The primary key column is named `user_id` for backward compatibility but now
 * holds the BILLING-OWNER id, which is either a Clerk user id (`user_*`) or a
 * Clerk org id (`org_*`). The `owner_type` column ('user'|'org') records which.
 *
 * Monotonic write guard: `upsertSubscription` takes an optional `eventTimestamp`
 * (unix seconds from the Polar webhook envelope). Webhook deliveries are
 * at-least-once and can arrive out of order (retries, replays); without a guard
 * a late/older event can stomp newer state written by a fresher one. The upsert
 * only applies when the incoming `eventTimestamp` is `>=` the stored value (or
 * either side is null/unset — first write, or a caller without an event
 * ordering such as the Polar-truth write-through cache path, which always wins).
 */

import type { PlanId } from '@chm/pricing'

export type OwnerType = 'user' | 'org'

/**
 * Minimal structural subset of Cloudflare's `D1Database` used by this store.
 * Kept here so the package needs neither `@cloudflare/workers-types` nor any
 * runtime dependency — the real `D1Database` satisfies it structurally.
 */
export interface D1Like {
  prepare(sql: string): D1PreparedLike
}
export interface D1PreparedLike {
  bind(...values: unknown[]): D1BoundLike
}
export interface D1BoundLike {
  run(): Promise<unknown>
  first<T = unknown>(): Promise<T | null>
}

export interface UserSubscription {
  /** Billing-owner id — Clerk user id OR Clerk org id. */
  userId: string
  /** 'user' for personal subscriptions; 'org' for org-owned paid plans. */
  ownerType: OwnerType
  planId: PlanId
  billingPeriod: 'monthly' | 'yearly' | null
  status: string
  polarSubscriptionId: string | null
  polarCustomerId: string | null
  /** Unix seconds; access valid until then. null for free. */
  currentPeriodEnd: number | null
  /** True when the owner cancelled but is still inside the paid period. */
  cancelAtPeriodEnd: boolean
  createdAt: number
  updatedAt: number
}

export interface UpsertSubscriptionInput {
  /** Billing-owner id — Clerk user id OR Clerk org id. */
  userId: string
  /** 'user' for personal subscriptions; 'org' for org-owned paid plans. Default 'user'. */
  ownerType?: OwnerType
  planId: PlanId
  billingPeriod: 'monthly' | 'yearly' | null
  status: string
  polarSubscriptionId?: string | null
  polarCustomerId?: string | null
  currentPeriodEnd?: number | null
  /** Default false. */
  cancelAtPeriodEnd?: boolean
  /**
   * Unix seconds from the source event (e.g. the Polar webhook envelope's
   * `timestamp`). When set, the write is rejected if a later event has already
   * been applied — see the monotonic write guard note above. Leave unset for
   * callers without an event ordering (e.g. the Polar-truth write-through
   * cache), which always win.
   */
  eventTimestamp?: number | null
}

interface D1SubscriptionRow {
  user_id: string
  owner_type: string | null
  plan_id: string
  billing_period: string | null
  status: string
  polar_subscription_id: string | null
  polar_customer_id: string | null
  current_period_end: number | null
  cancel_at_period_end: number | null
  created_at: number
  updated_at: number
}

function rowToSubscription(row: D1SubscriptionRow): UserSubscription {
  return {
    userId: row.user_id,
    ownerType: (row.owner_type as OwnerType | null) ?? 'user',
    planId: row.plan_id as PlanId,
    billingPeriod: (row.billing_period as 'monthly' | 'yearly' | null) ?? null,
    status: row.status,
    polarSubscriptionId: row.polar_subscription_id,
    polarCustomerId: row.polar_customer_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Read a subscription by billing-owner id (user id or org id), or null when
 * none exists. Degrades gracefully (returns null) on ANY D1 error — most
 * importantly a missing `user_subscriptions` table when the binding is
 * provisioned but migrations have not been applied yet. `onError` lets the
 * caller log through its own logger without this package importing one.
 */
export async function getSubscription(
  db: D1Like,
  ownerId: string,
  onError?: (err: unknown) => void
): Promise<UserSubscription | null> {
  try {
    const row = await db
      .prepare(
        `SELECT user_id, owner_type, plan_id, billing_period, status,
                polar_subscription_id, polar_customer_id, current_period_end,
                cancel_at_period_end, created_at, updated_at
         FROM user_subscriptions WHERE user_id = ?1`
      )
      .bind(ownerId)
      .first<D1SubscriptionRow>()
    return row ? rowToSubscription(row) : null
  } catch (err) {
    onError?.(err)
    return null
  }
}

/**
 * Insert or replace a subscription row (idempotent on owner id).
 * `input.userId` is the billing-owner id (user or org).
 *
 * Monotonic on `event_timestamp` when `input.eventTimestamp` is provided: the
 * `DO UPDATE ... WHERE` clause only applies the update when the existing row
 * has no event_timestamp yet or the incoming one is `>=` it, so an
 * out-of-order/replayed older webhook delivery can never stomp state written by
 * a newer one. When `input.eventTimestamp` is omitted, the guard is bypassed —
 * that path is always authoritative.
 */
export async function upsertSubscription(
  db: D1Like,
  input: UpsertSubscriptionInput
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const ownerType: OwnerType = input.ownerType ?? 'user'
  const eventTimestamp = input.eventTimestamp ?? null
  await db
    .prepare(
      `INSERT INTO user_subscriptions
         (user_id, owner_type, plan_id, billing_period, status,
          polar_subscription_id, polar_customer_id, current_period_end,
          cancel_at_period_end, event_timestamp, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT(user_id) DO UPDATE SET
         owner_type = excluded.owner_type,
         plan_id = excluded.plan_id,
         billing_period = excluded.billing_period,
         status = excluded.status,
         polar_subscription_id = excluded.polar_subscription_id,
         polar_customer_id = excluded.polar_customer_id,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         event_timestamp = excluded.event_timestamp,
         updated_at = excluded.updated_at
       WHERE excluded.event_timestamp IS NULL
          OR user_subscriptions.event_timestamp IS NULL
          OR excluded.event_timestamp >= user_subscriptions.event_timestamp`
    )
    .bind(
      input.userId,
      ownerType,
      input.planId,
      input.billingPeriod,
      input.status,
      input.polarSubscriptionId ?? null,
      input.polarCustomerId ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      eventTimestamp,
      now
    )
    .run()
}
