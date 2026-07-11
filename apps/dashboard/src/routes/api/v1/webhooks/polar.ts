/**
 * POST /api/v1/webhooks/polar — Polar webhook receiver.
 *
 * Verifies the signature over the RAW body (validateEvent base64-encodes the
 * secret internally), then hands the subscription event to the shared,
 * framework-agnostic core (`@chm/billing-webhook-core`), injecting the
 * dashboard's runtime collaborators (Clerk lazy-org creation, Polar customer
 * re-key, the retry-wrapped D1 write, negative-cache invalidation, the PostHog
 * funnel event, and the audit-log write). The ORCHESTRATION — owner resolution
 * (`user_*` first paid event → lazy org + re-key; `org_*` direct), the
 * live/paid distinction, monotonic persistence, and the funnel/audit gating —
 * lives in the core so this Worker and the cloud-hooks Worker apply IDENTICAL
 * logic and cannot fork during the migration to hooks.chmonitor.dev.
 *
 * Always 2xx on a valid, handled event so Polar doesn't retry. 403 on bad
 * signature. Unauthenticated by design — the signature IS the auth.
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  type ApplySubscriptionDeps,
  applySubscription as coreApplySubscription,
  type PolarSubscriptionData,
  toUnixSeconds,
} from '@chm/billing-webhook-core'
import { error as logError, log as logInfo } from '@chm/logger'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { captureServerEvent } from '@/lib/analytics/analytics.server'
import { logEvent } from '@/lib/audit/logEvent'
import {
  getPolarClient,
  getWebhookSecret,
  planForProductId,
} from '@/lib/billing/polar-config'
import { invalidateNegativeCache } from '@/lib/billing/polar-subscription'
import { upsertSubscription } from '@/lib/billing/subscription-store'

/**
 * Attempt to lazily create a Clerk org for a user on their first paid event.
 * Returns the orgId if successful, null on any error (billing is saved under
 * userId as a fallback so payment is never lost).
 *
 * Idempotent: if the user already has an org membership, returns that org's id
 * without creating a duplicate.
 */
async function ensureOrgForUser(userId: string): Promise<string | null> {
  try {
    const { clerkClient } = await import('@clerk/tanstack-react-start/server')
    const client = clerkClient()

    // Check existing memberships first (idempotency guard).
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
    })
    if (memberships.data.length > 0) {
      const existingOrgId = memberships.data[0]?.organization?.id
      if (existingOrgId) {
        logInfo('[polar-webhook] user already has org; reusing', {
          userId,
          orgId: existingOrgId,
        })
        return existingOrgId
      }
    }

    // Create a new Clerk org for the buyer.
    const org = await client.organizations.createOrganization({
      name: `${userId} workspace`,
      createdBy: userId,
    })
    logInfo('[polar-webhook] created Clerk org for paid user', {
      userId,
      orgId: org.id,
    })
    return org.id
  } catch (err) {
    // Org creation is best-effort: Clerk orgs may be quota-limited or disabled.
    // Log the error but do not lose the subscription — caller falls back to userId.
    logError(
      '[polar-webhook] org creation failed; falling back to user owner',
      {
        userId,
        err,
      }
    )
    return null
  }
}

/**
 * Re-key the Polar customer's externalId from the buyer's userId to the newly
 * created orgId. Best-effort: on failure the D1 row is still correct (keyed
 * by orgId), but `pullOwnerSubscriptionFromPolar(orgId)` will 404 until this
 * is retried — logged as an error so it's alertable, not lost silently.
 */
async function rekeyCustomerToOrg(
  customerId: string,
  orgId: string
): Promise<void> {
  try {
    await getPolarClient().customers.update({
      id: customerId,
      customerUpdate: { externalId: orgId },
    })
    logInfo('[polar-webhook] re-keyed Polar customer externalId to org', {
      customerId,
      orgId,
    })
  } catch (err) {
    logError(
      '[polar-webhook] failed to re-key Polar customer externalId to org; ' +
        'Polar-truth fallback will 404 for this org until retried',
      { customerId, orgId, err }
    )
  }
}

/** Retry a D1 write once before giving up — smooths over transient blips. */
async function upsertSubscriptionWithRetry(
  input: Parameters<typeof upsertSubscription>[0]
): Promise<void> {
  try {
    await upsertSubscription(input)
  } catch (firstErr) {
    logError('[polar-webhook] D1 cache write failed; retrying once', {
      ownerId: input.userId,
      ownerType: input.ownerType,
      err: firstErr,
    })
    await upsertSubscription(input)
  }
}

/** Assemble the dashboard runtime collaborators the core flow needs. */
function makeDeps(): ApplySubscriptionDeps {
  return {
    planForProductId,
    ensureOrgForUser,
    rekeyCustomerToOrg,
    upsertSubscription: upsertSubscriptionWithRetry,
    invalidateNegativeCache,
    // Funnel event: a brand-new PAID subscription went live. distinctId is the
    // browser's PostHog id (propagated by Polar from the checkout metadata) so
    // `upgrade_completed` stitches onto the same distinct id as the rest of the
    // funnel instead of the shared server id.
    onUpgradeCompleted: async ({ planId, period, distinctId }) => {
      await captureServerEvent(
        process.env as Record<string, string | undefined>,
        'upgrade_completed',
        { plan_id: planId, billing_period: period },
        distinctId
      )
    },
    // Best-effort audit trail — org-scoped only (a user-type owner has no org).
    logBillingAudit: async ({
      orgId,
      planId,
      status,
      subscriptionId,
      canceled,
    }) => {
      await logEvent({
        orgId,
        userId: null,
        event: canceled ? 'billing.canceled' : 'billing.plan_changed',
        resource: planId,
        action: 'update',
        result: 'success',
        metadata: { status, subscriptionId },
      })
    },
    logInfo,
    logError,
  }
}

/** Run the shared core flow with the dashboard's injected collaborators. */
function applySubscription(
  data: PolarSubscriptionData,
  eventTimestamp: number | null,
  eventType?: string
): Promise<void> {
  return coreApplySubscription(data, eventTimestamp, eventType, makeDeps())
}

/** Test-only export — exercises the full owner-resolution + persistence path. */
export async function __applySubscriptionForTests(
  data: PolarSubscriptionData,
  eventTimestamp?: number | null,
  eventType?: string
): Promise<void> {
  return applySubscription(data, eventTimestamp ?? null, eventType)
}

async function handlePost(request: Request): Promise<Response> {
  const secret = getWebhookSecret()
  if (!secret) {
    return Response.json(
      { error: 'Billing webhook not configured' },
      { status: 501 }
    )
  }

  const body = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  let event: ReturnType<typeof validateEvent>
  try {
    event = validateEvent(body, headers, secret)
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return Response.json({ error: 'Invalid signature' }, { status: 403 })
    }
    logError('[polar-webhook] failed to parse event', err)
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.active':
      case 'subscription.canceled':
      case 'subscription.uncanceled':
      case 'subscription.revoked':
      case 'subscription.past_due':
        await applySubscription(
          event.data as unknown as PolarSubscriptionData,
          toUnixSeconds(event.timestamp),
          event.type
        )
        break
      default:
        // Acknowledge unhandled events (checkout.*, order.*, etc.) without action.
        break
    }
  } catch (err) {
    // Persistence failed — 500 so Polar retries with backoff.
    logError('[polar-webhook] handler error', err)
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ received: true }, { status: 202 })
}

export const Route = createFileRoute('/api/v1/webhooks/polar')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
