/**
 * Maintenance windows CRUD (plan 28)
 * GET    /api/v1/health/maint-windows        — list windows for the caller's owner
 * POST   /api/v1/health/maint-windows        — create a window
 * DELETE /api/v1/health/maint-windows?id=... — delete a window
 *
 * Auth: GET is covered by the global /api/v1 middleware auth gate (same as
 * the sibling checks.ts/snapshot.ts/history.ts routes). POST/DELETE
 * self-enforce a write gate (`authorizeFeatureRequest`, feature 'settings')
 * because that global middleware is a public passthrough under
 * provider='none' / CHM_CLERK_PUBLIC_READ — mirrors webhook.ts's write gate.
 *
 * Owner resolution: `resolveBillingOwnerId()` reads the current Clerk session
 * (org if active, else user). It throws when Clerk isn't configured — this
 * route treats that as the OSS single-tenant owner (`''`) rather than
 * failing the request, per the plan's fail-open invariant (self-hosted with
 * no Clerk still gets a working, single-tenant maintenance-windows feature).
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { resolveBillingOwnerId } from '@/lib/billing/billing-owner'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  createWindow,
  deleteWindow,
  listWindows,
} from '@/lib/health/maintenance-windows'

/** OSS single-tenant fallback when Clerk is not configured / no session. */
async function resolveOwnerId(): Promise<string> {
  try {
    return await resolveBillingOwnerId()
  } catch {
    return ''
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { success: false, error: { type: 'validation', message } },
    { status }
  )
}

const CreateWindowSchema = z.object({
  hostId: z.number().int().nonnegative().nullable(),
  reason: z.string().max(500).optional().default(''),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().nonnegative(),
})

async function handleGet(): Promise<Response> {
  const ownerId = await resolveOwnerId()
  const windows = await listWindows(ownerId)
  return Response.json(
    { success: true, windows },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
      },
    }
  )
}

async function handlePost(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const parsed = CreateWindowSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(
      `Invalid request body: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    )
  }
  const { hostId, reason, startsAt, endsAt } = parsed.data

  if (endsAt <= startsAt) {
    return jsonError('"endsAt" must be after "startsAt"', 400)
  }

  const ownerId = await resolveOwnerId()
  try {
    const window = await createWindow({
      ownerId,
      hostId,
      reason,
      startsAt,
      endsAt,
      createdBy: ownerId,
    })
    return Response.json({ success: true, window }, { status: 201 })
  } catch (err) {
    return jsonError(
      err instanceof Error
        ? err.message
        : 'Failed to create maintenance window',
      500
    )
  }
}

async function handleDelete(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return jsonError('Missing "id" query parameter', 400)
  }

  const ownerId = await resolveOwnerId()
  await deleteWindow(ownerId, id)
  return Response.json({ success: true })
}

export const Route = createFileRoute('/api/v1/health/maint-windows')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
