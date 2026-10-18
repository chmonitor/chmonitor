/**
 * Maintenance windows CRUD (plan 28)
 * GET    /api/v1/health/maint-windows        — list windows for the caller's owner
 * POST   /api/v1/health/maint-windows        — create a window
 * DELETE /api/v1/health/maint-windows?id=... — delete a window
 *
 * Auth: GET rides the global /api/v1 middleware. POST/DELETE
 * self-enforce a write gate (`authorizeFeatureRequest`, feature 'settings')
 * because that global middleware is a public passthrough under
 * provider='none' / CHM_CLERK_PUBLIC_READ — mirrors webhook.ts's write gate.
 *
 * Owner resolution: `resolveConfigOwner(request, 'billing')` — the Clerk
 * session's org if active, else its user. Self-hosted without a session gets
 * the OSS single-tenant owner (`''`); cloud without a session gets a 401.
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { resolveConfigOwner } from '@/lib/health/alert-routing-auth'
import {
  createWindow,
  deleteWindow,
  listWindows,
  MaintenanceStoreUnavailableError,
} from '@/lib/health/maintenance-windows'

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

async function handleGet(request: Request): Promise<Response> {
  const ownerId = await resolveConfigOwner(request, 'billing')
  if (ownerId instanceof Response) return ownerId
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

  const ownerId = await resolveConfigOwner(request, 'billing')
  if (ownerId instanceof Response) return ownerId
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

  const ownerId = await resolveConfigOwner(request, 'billing')
  if (ownerId instanceof Response) return ownerId
  let deleted: number
  try {
    deleted = await deleteWindow(ownerId, id)
  } catch (err) {
    if (err instanceof MaintenanceStoreUnavailableError) {
      return jsonError(err.message, 503)
    }
    return jsonError(
      err instanceof Error
        ? err.message
        : 'Failed to delete maintenance window',
      500
    )
  }
  if (deleted === 0) {
    return jsonError(`Maintenance window "${id}" not found`, 404)
  }
  return Response.json({ success: true, deleted })
}

export const __handleDeleteForTests = handleDelete
export const __handleGetForTests = handleGet
export const __handlePostForTests = handlePost

export const Route = createFileRoute('/api/v1/health/maint-windows')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
