/**
 * POST /api/v1/webhooks/clerk — Clerk webhook receiver.
 *
 * Verifies the signature via Clerk's built-in verifyWebhook(), then enforces
 * the seat cap for `organizationMembership.created` events. If the new
 * member would push the org over its plan's seat limit, the membership is
 * rolled back synchronously via Clerk's deleteOrganizationMembership API.
 *
 * All other events are acknowledged (202) without action.
 * 501 when CLERK_WEBHOOK_SECRET is unset. 403 on bad signature.
 * 500 on unexpected handler errors (Clerk will retry with backoff).
 *
 * Unauthenticated by design — the signature IS the auth.
 *
 * Registry gate: routes/api/v1/webhooks/clerk.ts
 *   organizationMembership.created → checkSeatLimit (rollback over-limit member)
 */
import { createFileRoute } from '@tanstack/react-router'

import type { WebhookEvent } from '@clerk/tanstack-react-start/webhooks'

import { error as logError, log as logInfo } from '@chm/logger'
import { verifyWebhook } from '@clerk/tanstack-react-start/webhooks'
import { getClerkWebhookSecret } from '@/lib/billing/clerk-webhook-config'
import { checkSeatLimit } from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'

async function handlePost(request: Request): Promise<Response> {
  const secret = getClerkWebhookSecret()
  if (!secret) {
    return Response.json(
      { error: 'Clerk webhook not configured' },
      { status: 501 }
    )
  }

  let event: WebhookEvent
  try {
    event = await verifyWebhook(request, { signingSecret: secret })
  } catch (err) {
    logError('[clerk-webhook] signature verification failed', err)
    return Response.json({ error: 'Invalid signature' }, { status: 403 })
  }

  try {
    switch (event.type) {
      case 'organizationMembership.created': {
        const orgId = event.data.organization.id
        const userId = event.data.public_user_data.user_id

        const plan = await getPlanForOwner(orgId)

        if (plan.seats == null) {
          // Enterprise: unlimited seats — always allow.
          break
        }

        const { clerkClient } = await import(
          '@clerk/tanstack-react-start/server'
        )
        const memberships =
          await clerkClient().organizations.getOrganizationMembershipList({
            organizationId: orgId,
            limit: 100,
          })
        const count = memberships.data.length

        // The `organizationMembership.created` webhook fires after Clerk has
        // already added the new member, so `count` is the post-addition total.
        // `checkSeatLimit` uses `used < limit` ("is there room for one more?"),
        // so pass the pre-addition count to ask whether this new member fits.
        const check = checkSeatLimit(plan, count - 1)
        if (!check.allowed) {
          await clerkClient().organizations.deleteOrganizationMembership({
            organizationId: orgId,
            userId,
          })
          logInfo(
            '[clerk-webhook] seat cap enforced — over-limit membership rolled back',
            {
              orgId,
              userId,
              planId: plan.id,
              seats: plan.seats,
              currentCount: count,
            }
          )
        }
        break
      }
      default:
        // Acknowledge all other event types without action.
        break
    }
  } catch (err) {
    // Unexpected error — 500 so Clerk retries with backoff.
    logError('[clerk-webhook] handler error', err)
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ received: true }, { status: 202 })
}

export const Route = createFileRoute('/api/v1/webhooks/clerk')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
