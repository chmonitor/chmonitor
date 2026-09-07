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
 *   CHM_POLAR_LICENSE_<SKU>_<TERM>           self-host license products
 *     e.g. CHM_POLAR_LICENSE_TEAM_YEARLY, CHM_POLAR_LICENSE_UNLIMITED_LIFETIME
 *   CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>        archived Cloud seats catalog
 *     leftover mapping only; Polar products are archived, env unset in prod
 *
 * Product ids live in env (not plans.ts) because they differ per Polar org /
 * environment; plans.ts stays the pricing + capability source of truth.
 *
 * `nodejs_compat_populate_process_env` (wrangler.toml) mirrors Worker vars +
 * secrets onto process.env, so reading process.env works in the Worker runtime.
 */

import type { LicenseTerm, PaidLicenseId } from '@chm/pricing'
import type { PlanId } from './plans'

import { createPolarHttpClient, type PolarHttpClient } from './polar-http'
import {
  licensePolarProductEnvKey,
  PAID_LICENSE_IDS,
  planForProductIdFromLookup,
  SUBSCRIBABLE_PLAN_IDS,
  type SubscribablePlanId,
  subscribablePlanProductEnvKey,
} from '@chm/pricing'

export type BillingPeriod = 'monthly' | 'yearly'

/** Paid plans that map to a Polar product. enterprise is not self-serve. */
export const PAID_PLAN_IDS = ['pro', 'max'] as const
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number]

export { SUBSCRIBABLE_PLAN_IDS, type SubscribablePlanId }

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

let cachedClient: PolarHttpClient | null = null

/**
 * Lazily construct the Polar client. Throws if the token is missing.
 * Uses a thin REST wrapper (not `@polar-sh/sdk`) so the Worker stays under
 * the free-plan size limit — see polar-http.ts.
 */
export function getPolarClient(): PolarHttpClient {
  if (cachedClient) return cachedClient
  const accessToken = readEnv('POLAR_ACCESS_TOKEN')
  if (!accessToken) {
    throw new Error('POLAR_ACCESS_TOKEN is not configured')
  }
  cachedClient = createPolarHttpClient(accessToken)
  return cachedClient
}

export function getWebhookSecret(): string | undefined {
  return readEnv('POLAR_WEBHOOK_SECRET')
}

const productEnvKey = subscribablePlanProductEnvKey

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
  return planForProductIdFromLookup(readEnv, productId)
}

export function licenseProductIdFor(
  id: PaidLicenseId,
  term: LicenseTerm
): string | null {
  return readEnv(licensePolarProductEnvKey(id, term)) ?? null
}

export function licenseForProductId(
  productId: string
): { sku: PaidLicenseId; term: LicenseTerm } | null {
  for (const id of PAID_LICENSE_IDS) {
    for (const term of ['yearly', 'lifetime'] as const) {
      if (licenseProductIdFor(id, term) === productId) {
        return { sku: id, term }
      }
    }
  }
  return null
}

export function isPaidLicenseId(value: string): value is PaidLicenseId {
  return (PAID_LICENSE_IDS as readonly string[]).includes(value)
}

/** Type guard usable by routes that accept a plan id from the client. */
export function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value)
}

/**
 * Type guard for a self-serve subscribable plan id (free/pro/max). Used by the
 * checkout route, which now accepts Free ($0) alongside the paid plans.
 */
export { isSubscribablePlanId } from '@chm/pricing'

export type { PlanId }
