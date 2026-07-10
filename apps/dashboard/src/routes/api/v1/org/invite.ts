/**
 * POST /api/v1/org/invite — seat-cap invite-time gate (plan 20).
 *
 * Checks the org's seat cap BEFORE creating a Clerk organization invitation,
 * so an over-cap invite is rejected with a 402 (`details.reason: 'seat_limit'`,
 * classified client-side as `'seat'` by `classifyBillingLimit` — see
 * lib/api/error-handler/error-classifier.ts) instead of admitting the member
 * and rolling them back afterward.
 *
 * This is the PRIMARY, pre-emptive enforcement path. The
 * `organizationMembership.created` webhook rollback
 * (routes/api/v1/webhooks/clerk.ts) stays as defense-in-depth for any
 * membership added via a path that bypasses this route (e.g. a direct Clerk
 * Dashboard add, or a future invite surface that doesn't call this endpoint).
 *
 * KNOWN GAP: today NOTHING in the app calls this route yet. The org "Invite"
 * UI is Clerk's hosted `<OrganizationProfile/>` widget
 * (components/clerk/organization-members.tsx), which issues invitations
 * directly from the browser via Clerk's own Frontend API and cannot be
 * repointed at a custom endpoint (`customPages` on the widget only ADDS pages,
 * it cannot replace the built-in Members-tab invite flow). So real UI invites
 * still rely solely on the webhook rollback until the widget is replaced with
 * a custom invite UI wired to this route — a separate, larger follow-up.
 *
 * Auth: requires a signed-in org admin. Mirrors
 * routes/api/v1/audit/export.ts — no `member:manage` RBAC permission exists
 * yet (lib/rbac/rbac.ts), so this composes the org-admin Clerk role directly.
 * The org id is always session-derived via `resolveBillingOwner()`, never a
 * request param, so a caller can only ever invite into their own org.
 *
 * Fail-open (self-hosted/OSS stays whole): plan resolution + member/pending
 * invite enumeration is wrapped in `preCheckSeatLimit`, which returns `null`
 * — "skip the check" — on ANY failure there (Clerk not configured, Clerk API
 * hiccup). A seat-check failure can never block an invite; it can only
 * under-enforce, matching the fail-safe convention used by `countOwnerHosts`
 * (lib/billing/org-host-count.ts).
 */
import { createFileRoute } from '@tanstack/react-router'

import type { BillingOwner } from '@/lib/billing/billing-owner'
import type { LimitCheck } from '@/lib/billing/entitlements'

import { auth } from '@clerk/tanstack-react-start/server'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { logEvent } from '@/lib/audit/logEvent'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { checkSeatLimit, limitMessage } from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'

const ROUTE = { route: '/api/v1/org/invite', method: 'POST' }

interface InviteRequest {
  emailAddress: string
  role?: string
}

function unauthorized(message: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.PermissionError, message },
    401,
    ROUTE
  )
}

function forbidden(message: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.PermissionError, message },
    403,
    ROUTE
  )
}

function badRequest(message: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.ValidationError, message },
    400,
    ROUTE
  )
}

/** The 402 response shape the plan-15 `PaywallModal` classifies as `reason: 'seat'`. */
function seatLimitResponse(check: LimitCheck): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message: limitMessage(check),
      details: {
        planId: check.planId,
        limit: check.limit ?? undefined,
        reason: check.reason,
      },
    },
    402,
    ROUTE
  )
}

/**
 * Pre-check the org's seat cap for one more invite. Returns `null` when the
 * check should be SKIPPED — the plan is unlimited, or plan/member/invite
 * resolution threw (most commonly: Clerk isn't configured). Never throws.
 *
 * At invite time the new member has NOT been added yet, so this passes the
 * LIVE member count to `checkSeatLimit` (no `-1`) — unlike the post-hoc
 * webhook rollback in webhooks/clerk.ts, which fires after Clerk has already
 * added the member and so subtracts one to ask the same "room for one more?"
 * question against the pre-addition roster.
 *
 * Counts pending invitations too, not just current members: without this, an
 * org already at its seat cap could dispatch unlimited invites (each one only
 * bounced post-hoc, after accept, by the webhook rollback — a worse UX and a
 * correctness gap).
 */
async function preCheckSeatLimit(orgId: string): Promise<LimitCheck | null> {
  try {
    const plan = await getPlanForOwner(orgId)
    if (plan.seats == null) return null // unlimited — nothing to check

    const { clerkClient } = await import('@clerk/tanstack-react-start/server')
    const client = clerkClient()
    // Both list calls cap at 100 with no pagination — fine while seat caps
    // top out at 10, but an org with >100 members/pending-invites would
    // undercount here.
    const memberships =
      await client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100,
      })
    const pending = await client.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      status: ['pending'],
      limit: 100,
    })

    return checkSeatLimit(plan, memberships.data.length + pending.data.length)
  } catch {
    return null
  }
}

async function handlePost(request: Request): Promise<Response> {
  let owner: BillingOwner
  try {
    owner = await resolveBillingOwner()
  } catch {
    return unauthorized('Authentication is required to invite a teammate.')
  }

  if (owner.type !== 'org') {
    return forbidden('An active organization is required to invite teammates.')
  }

  const authResult = await auth()
  const orgRole = (authResult as { orgRole?: string | null } | null)?.orgRole
  if (orgRole !== 'org:admin') {
    return forbidden('Only organization admins can invite teammates.')
  }

  let body: Partial<InviteRequest>
  try {
    body = (await request.json()) as Partial<InviteRequest>
  } catch {
    return badRequest('Request body must be valid JSON')
  }

  const emailAddress = body.emailAddress?.trim()
  if (!emailAddress) {
    return badRequest('emailAddress is required')
  }
  const role = body.role?.trim() || 'org:member'

  const orgId = owner.id
  const userId = authResult?.userId ?? null

  const check = await preCheckSeatLimit(orgId)
  if (check && !check.allowed) {
    await logEvent({
      orgId,
      userId,
      event: 'member.invited',
      resource: emailAddress,
      action: 'invite',
      result: 'denied',
    })
    return seatLimitResponse(check)
  }

  const { clerkClient } = await import('@clerk/tanstack-react-start/server')
  let invitation: { id: string }
  try {
    invitation = await clerkClient().organizations.createOrganizationInvitation(
      {
        organizationId: orgId,
        emailAddress,
        role,
        inviterUserId: userId ?? undefined,
      }
    )
  } catch (err) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message:
          err instanceof Error ? err.message : 'Failed to create invitation',
      },
      500,
      ROUTE
    )
  }

  await logEvent({
    orgId,
    userId,
    event: 'member.invited',
    resource: emailAddress,
    action: 'invite',
    result: 'success',
  })

  return Response.json(
    { success: true, invitationId: invitation.id },
    { status: 200 }
  )
}

export const Route = createFileRoute('/api/v1/org/invite')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
