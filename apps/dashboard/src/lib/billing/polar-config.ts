/**
 * Polar billing — runtime config + product↔plan mapping.
 *
 * Cloud (SaaS) only. OSS/self-host never calls this (auth is `none` ⇒ unlimited,
 * plans inert — see plans.ts). All values come from the environment so sandbox
 * and production differ without code changes, matching the repo's "one canonical
 * CHM_* name" philosophy (see CLAUDE.md):
 *
 *   POLAR_ACCESS_TOKEN          (secret)     org access token
 *   POLAR_WEBHOOK_SECRET        (secret)     verifies inbound webhooks
 *   CHM_POLAR_SERVER            sandbox|production (default sandbox)
 *   CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>        Polar product id per plan/period
 *     e.g. CHM_POLAR_PRODUCT_PRO_MONTHLY, CHM_POLAR_PRODUCT_MAX_YEARLY,
 *          CHM_POLAR_PRODUCT_FREE_MONTHLY (Free is a $0 monthly-only product)
 *
 * Product ids live in env (not plans.ts) because they differ per Polar org /
 * environment; plans.ts stays the pricing + capability source of truth.
 *
 * `nodejs_compat_populate_process_env` (wrangler.toml) mirrors Worker vars +
 * secrets onto process.env, so reading process.env works in the Worker runtime.
 */

import type { PlanId } from './plans'

import { Polar } from '@polar-sh/sdk'

export type BillingPeriod = 'monthly' | 'yearly'

/** Paid plans that map to a Polar product. enterprise is not self-serve. */
export const PAID_PLAN_IDS = ['pro', 'max'] as const
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number]

/**
 * Plans a user can self-serve subscribe to via Polar checkout. Free is a real
 * $0 Polar subscription so an active-subscription gate (create-connection)
 * treats it uniformly with paid plans. Free is monthly-only — it has no yearly
 * product (see productIdFor). enterprise stays sales-led, not self-serve.
 */
export const SUBSCRIBABLE_PLAN_IDS = ['free', 'pro', 'max'] as const
export type SubscribablePlanId = (typeof SUBSCRIBABLE_PLAN_IDS)[number]

function readEnv(key: string): string | undefined {
  const v = process.env[key]
  return v === undefined || v === '' ? undefined : v
}

export function getPolarServer(): 'sandbox' | 'production' {
  return readEnv('CHM_POLAR_SERVER') === 'production' ? 'production' : 'sandbox'
}

/**
 * True when Polar is wired up enough to make API calls (token present). Routes
 * use this to fail with a clear 501 instead of throwing on a missing token.
 */
export function isBillingConfigured(): boolean {
  return Boolean(readEnv('POLAR_ACCESS_TOKEN'))
}

let cachedClient: Polar | null = null

/** Lazily construct the Polar client. Throws if the token is missing. */
export function getPolarClient(): Polar {
  if (cachedClient) return cachedClient
  const accessToken = readEnv('POLAR_ACCESS_TOKEN')
  if (!accessToken) {
    throw new Error('POLAR_ACCESS_TOKEN is not configured')
  }
  cachedClient = new Polar({ accessToken, server: getPolarServer() })
  return cachedClient
}

export function getWebhookSecret(): string | undefined {
  return readEnv('POLAR_WEBHOOK_SECRET')
}

function productEnvKey(
  planId: SubscribablePlanId,
  period: BillingPeriod
): string {
  return `CHM_POLAR_PRODUCT_${planId.toUpperCase()}_${period.toUpperCase()}`
}

/**
 * Polar product id for a subscribable plan + period, or null when not
 * configured. Free is monthly-only: free/yearly is never a real product, so it
 * short-circuits to null before touching the env.
 */
export function productIdFor(
  planId: SubscribablePlanId,
  period: BillingPeriod
): string | null {
  if (planId === 'free' && period === 'yearly') return null
  return readEnv(productEnvKey(planId, period)) ?? null
}

/** Reverse map: resolve a Polar product id back to our plan + period. */
export function planForProductId(
  productId: string
): { planId: SubscribablePlanId; period: BillingPeriod } | null {
  for (const planId of SUBSCRIBABLE_PLAN_IDS) {
    for (const period of ['monthly', 'yearly'] as const) {
      if (productIdFor(planId, period) === productId) return { planId, period }
    }
  }
  return null
}

/** Type guard usable by routes that accept a plan id from the client. */
export function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value)
}

/**
 * Type guard for a self-serve subscribable plan id (free/pro/max). Used by the
 * checkout route, which now accepts Free ($0) alongside the paid plans.
 */
export function isSubscribablePlanId(
  value: string
): value is SubscribablePlanId {
  return (SUBSCRIBABLE_PLAN_IDS as readonly string[]).includes(value)
}

export type { PlanId }
