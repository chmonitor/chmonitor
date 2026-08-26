/**
 * cloud-hooks implementations of the `@chm/billing-webhook-core` collaborators.
 *
 * The ORCHESTRATION lives in the core; this module provides the runtime bits
 * for a plain Cloudflare Worker (no TanStack / Clerk-React): the env-driven
 * product→plan map, lazy Clerk org creation + Polar customer re-key over REST /
 * the Polar SDK, and the D1 upsert. These MUST behave like the dashboard's so
 * that once the Polar endpoint is cut over (plans/103 step 3-4) nothing forks.
 */

import type { PaidLicenseId } from '@chm/pricing'
import type { Env } from './env'

import {
  type ApplySubscriptionDeps,
  upsertSubscription as coreUpsertSubscription,
} from '@chm/billing-webhook-core'
import {
  licensePolarProductEnvKey,
  PAID_LICENSE_IDS,
  planForProductIdFromLookup,
} from '@chm/pricing'
import { logError, logInfo } from './log'

type BillingPeriod = 'monthly' | 'yearly'

function readEnv(env: Env, key: string): string | undefined {
  const v = env[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** Env-driven reverse map: Polar product id → our plan + period, or null. */
export function makePlanForProductId(
  env: Env
): (productId: string) => { planId: string; period: BillingPeriod } | null {
  return (productId: string) =>
    planForProductIdFromLookup((key) => readEnv(env, key), productId)
}

export function licenseForProductId(
  env: Env,
  productId: string
): { sku: PaidLicenseId; term: 'yearly' | 'lifetime' } | null {
  for (const sku of PAID_LICENSE_IDS) {
    for (const term of ['yearly', 'lifetime'] as const) {
      if (readEnv(env, licensePolarProductEnvKey(sku, term)) === productId) {
        return { sku, term }
      }
    }
  }
  return null
}

const CLERK_API = 'https://api.clerk.com/v1'

/**
 * Lazily resolve/create a Clerk org for a user's first paid event (Backend API
 * over fetch — no @clerk/backend dependency for a tiny Worker). Idempotent:
 * reuses an existing membership. Returns null on any failure so billing falls
 * back to the user owner and is never lost.
 */
export function makeEnsureOrgForUser(
  env: Env,
  fetchImpl: typeof fetch = fetch
): (userId: string) => Promise<string | null> {
  return async (userId: string) => {
    const key = env.CLERK_SECRET_KEY
    if (!key) {
      logError('[cloud-hooks] CLERK_SECRET_KEY unset; cannot create org', {
        userId,
      })
      return null
    }
    const auth = { authorization: `Bearer ${key}` }
    try {
      const memRes = await fetchImpl(
        `${CLERK_API}/users/${userId}/organization_memberships?limit=1`,
        { headers: auth }
      )
      if (memRes.ok) {
        const body = (await memRes.json()) as {
          data?: Array<{ organization?: { id?: string } }>
        }
        const existing = body.data?.[0]?.organization?.id
        if (existing) return existing
      }

      const createRes = await fetchImpl(`${CLERK_API}/organizations`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${userId} workspace`,
          created_by: userId,
        }),
      })
      if (!createRes.ok) {
        logError('[cloud-hooks] Clerk org creation non-2xx', {
          userId,
          status: createRes.status,
        })
        return null
      }
      const org = (await createRes.json()) as { id?: string }
      return org.id ?? null
    } catch (err) {
      logError('[cloud-hooks] Clerk org creation failed', { userId, err })
      return null
    }
  }
}

/** Re-key the Polar customer's externalId to the org (Polar SDK). Best-effort. */
export function makeRekeyCustomerToOrg(
  env: Env
): (customerId: string, orgId: string) => Promise<void> {
  return async (customerId: string, orgId: string) => {
    const accessToken = env.POLAR_ACCESS_TOKEN
    if (!accessToken) {
      logError('[cloud-hooks] POLAR_ACCESS_TOKEN unset; cannot re-key', {
        customerId,
        orgId,
      })
      return
    }
    try {
      const { Polar } = await import('@polar-sh/sdk')
      const server =
        env.CHM_POLAR_SERVER === 'production' ? 'production' : 'sandbox'
      const client = new Polar({ accessToken, server })
      await client.customers.update({
        id: customerId,
        customerUpdate: { externalId: orgId },
      })
    } catch (err) {
      logError('[cloud-hooks] Polar customer re-key failed', {
        customerId,
        orgId,
        err,
      })
    }
  }
}

/** Retry a D1 write once before giving up — smooths over transient blips. */
function makeUpsertWithRetry(
  db: D1Database
): (input: Parameters<typeof coreUpsertSubscription>[1]) => Promise<void> {
  return async (input) => {
    try {
      await coreUpsertSubscription(db, input)
    } catch (firstErr) {
      logError('[cloud-hooks] D1 write failed; retrying once', {
        ownerId: input.userId,
        err: firstErr,
      })
      await coreUpsertSubscription(db, input)
    }
  }
}

/**
 * Assemble the full dependency set for `applySubscription`. Requires a D1
 * binding; the funnel + audit hooks are no-ops in v1 (the dashboard still owns
 * PostHog + org audit until the Polar endpoint is cut over).
 */
export function makeApplyDeps(
  env: Env,
  db: D1Database,
  fetchImpl: typeof fetch = fetch
): ApplySubscriptionDeps {
  return {
    planForProductId: makePlanForProductId(env),
    ensureOrgForUser: makeEnsureOrgForUser(env, fetchImpl),
    rekeyCustomerToOrg: makeRekeyCustomerToOrg(env),
    upsertSubscription: makeUpsertWithRetry(db),
    invalidateNegativeCache: () => {},
    onUpgradeCompleted: async () => {},
    logBillingAudit: async () => {},
    logInfo: (m, meta) => logInfo(m, meta),
    logError: (m, meta) => logError(m, meta),
  }
}
