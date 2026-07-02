/**
 * Subscription store — D1 persistence for billing state.
 *
 * The primary key column is named `user_id` for backward compatibility but now
 * holds the BILLING-OWNER id, which is either a Clerk user id (user_*) or a
 * Clerk org id (org_*). The `owner_type` column ('user'|'org') records which
 * kind, added by migration 0004_subscription_owner.sql. `cancel_at_period_end`
 * and `event_timestamp` were added by migration
 * 0008_subscription_cancel_and_event_guard.sql.
 *
 * Reads degrade gracefully: when the CHM_CLOUD_D1 binding is absent (local dev,
 * self-host) or there is no row, `getSubscription()` returns null and the caller
 * falls back to the free plan. Writes require D1 and are only exercised by the
 * Polar webhook (cloud runtime), so they throw if the binding is missing.
 *
 * Monotonic write guard: `upsertSubscription` takes an optional
 * `eventTimestamp` (unix seconds from the Polar webhook envelope). Webhook
 * deliveries are at-least-once and can arrive out of order (retries, replays);
 * without a guard a late/older event can stomp newer state written by a
 * fresher one. The upsert only applies when the incoming `eventTimestamp` is
 * `>=` the stored value (or either side is null/unset — first write, or a
 * caller that doesn't carry an event timestamp, e.g. the Polar-truth
 * write-through cache path, always wins so it never gets silently ignored).
 */

import type { PlanId } from './plans'

import { error as logError } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

export type OwnerType = 'user' | 'org'

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
   * `timestamp`). When set, the write is rejected if a later event has
   * already been applied — see the monotonic write guard note above. Leave
   * unset for callers without an event ordering (e.g. the Polar-truth
   * write-through cache), which always win.
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

function getDb() {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * Read a subscription by billing-owner id (user id or org id), or null when
 * none exists / no D1 binding.
 *
 * Degrades gracefully (returns null) on ANY D1 error — most importantly a
 * missing `user_subscriptions` table when the binding is provisioned but
 * migrations have not been applied yet. Without this, the raw SELECT throws
 * "no such table" and 500s every billing read; the caller reconciles from
 * Polar / falls back to free instead.
 */
export async function getSubscription(
  ownerId: string
): Promise<UserSubscription | null> {
  const db = getDb()
  if (!db) return null
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
    logError('[subscription-store] read failed; treating as no subscription', {
      ownerId,
      err,
    })
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
 * out-of-order/replayed older webhook delivery can never stomp state written
 * by a newer one. When `input.eventTimestamp` is omitted (e.g. the Polar-truth
 * write-through cache, which reads Polar's CURRENT state rather than replaying
 * a specific event), the guard is bypassed — that path is always authoritative.
 */
export async function upsertSubscription(
  input: UpsertSubscriptionInput
): Promise<void> {
  const db = getDb()
  if (!db) {
    throw new Error(
      'CHM_CLOUD_D1 binding not found; cannot persist subscription'
    )
  }
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
