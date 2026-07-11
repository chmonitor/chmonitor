/**
 * Subscription store — D1 persistence for billing state (dashboard binding).
 *
 * The store CONTRACT (the guarded upsert SQL + row mapping) now lives in the
 * framework-agnostic `@chm/billing-webhook-core` package so the dashboard Worker
 * and the cloud-hooks Worker cannot fork it. This module is the thin dashboard
 * adapter: it resolves the `CHM_CLOUD_D1` binding via `@chm/platform` and
 * delegates to the core, preserving the exact public signatures
 * (`getSubscription(ownerId)`, `upsertSubscription(input)`) the rest of the app
 * imports.
 *
 * Reads degrade gracefully: when the CHM_CLOUD_D1 binding is absent (local dev,
 * self-host) or there is no row, `getSubscription()` returns null and the caller
 * falls back to the free plan. Writes require D1 and are only exercised by the
 * Polar webhook (cloud runtime), so they throw if the binding is missing.
 */

import {
  getSubscription as coreGetSubscription,
  upsertSubscription as coreUpsertSubscription,
  type OwnerType,
  type UpsertSubscriptionInput,
  type UserSubscription,
} from '@chm/billing-webhook-core'
import { error as logError } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

export type { OwnerType, UpsertSubscriptionInput, UserSubscription }

function getDb() {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * Read a subscription by billing-owner id (user id or org id), or null when
 * none exists / no D1 binding. Degrades gracefully (returns null) on ANY D1
 * error — most importantly a missing `user_subscriptions` table when the
 * binding is provisioned but migrations have not been applied yet.
 */
export async function getSubscription(
  ownerId: string
): Promise<UserSubscription | null> {
  const db = getDb()
  if (!db) return null
  return coreGetSubscription(db, ownerId, (err) => {
    logError('[subscription-store] read failed; treating as no subscription', {
      ownerId,
      err,
    })
  })
}

/**
 * Insert or replace a subscription row (idempotent on owner id). Monotonic on
 * `event_timestamp` when provided — see the core store for the guard semantics.
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
  await coreUpsertSubscription(db, input)
}
