/**
 * POST /api/v1/org/invite — create a Clerk org invitation.
 * No seat/user cap. Auth: signed-in org admin.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { BillingOwner } from '@/lib/billing/billing-owner'

import { auth } from '@clerk/tanstack-react-start/server'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { logEvent } from '@/lib/audit/logEvent'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'

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
