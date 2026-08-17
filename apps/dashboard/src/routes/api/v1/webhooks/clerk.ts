/**
 * POST /api/v1/webhooks/clerk — Clerk webhook receiver.
 *
 * Verifies the signature via Clerk's built-in verifyWebhook().
 * All events are acknowledged (202) without a seat/user cap.
 * 501 when CLERK_WEBHOOK_SECRET is unset. 403 on bad signature.
 * 500 on unexpected handler errors (Clerk will retry with backoff).
 *
 * Unauthenticated by design — the signature IS the auth.
 *
 */
import { createFileRoute } from '@tanstack/react-router'

import type { WebhookEvent } from '@clerk/tanstack-react-start/webhooks'

import { error as logError } from '@chm/logger'
import { verifyWebhook } from '@clerk/tanstack-react-start/webhooks'
import { logEvent } from '@/lib/audit/logEvent'
import { getClerkWebhookSecret } from '@/lib/billing/clerk-webhook-config'

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

        await logEvent({
          orgId,
          userId,
          event: 'member.invited',
          resource: userId,
          action: 'invite',
          result: 'success',
        })
        break
      }
      case 'organizationMembership.deleted': {
        const orgId = event.data.organization.id
        const userId = event.data.public_user_data.user_id

        await logEvent({
          orgId,
          userId,
          event: 'member.removed',
          resource: userId,
          action: 'delete',
          result: 'success',
        })
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
