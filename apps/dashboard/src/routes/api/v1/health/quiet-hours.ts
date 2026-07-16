/**
 * Quiet hours CRUD (#2662)
 * GET    /api/v1/health/quiet-hours        — list windows for the caller's owner
 * POST   /api/v1/health/quiet-hours        — create a window
 * DELETE /api/v1/health/quiet-hours?id=... — delete a window
 *
 * Auth mirrors the sibling maint-windows.ts route: GET rides the global
 * /api/v1 middleware auth gate; POST/DELETE self-enforce a write gate
 * (`authorizeFeatureRequest`, feature 'settings') because that middleware is a
 * public passthrough under provider='none' / CHM_CLERK_PUBLIC_READ. Owner
 * resolution falls back to the OSS single-tenant owner (`''`) when Clerk isn't
 * configured, per the fail-open invariant.
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { resolveBillingOwnerId } from '@/lib/billing/billing-owner'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  createQuietHours,
  deleteQuietHours,
  listQuietHours,
} from '@/lib/health/quiet-hours'

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

const CreateQuietHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  start: z.string().regex(/^\d{1,2}:\d{2}$/, 'start must be HH:mm'),
  end: z.string().regex(/^\d{1,2}:\d{2}$/, 'end must be HH:mm'),
  timezone: z.string().min(1),
  severityCap: z.literal('critical').nullable().optional().default(null),
})

async function handleGet(): Promise<Response> {
  const ownerId = await resolveOwnerId()
  const windows = await listQuietHours(ownerId)
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

  const parsed = CreateQuietHoursSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(
      `Invalid request body: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    )
  }
  const { days, start, end, timezone, severityCap } = parsed.data

  const ownerId = await resolveOwnerId()
  try {
    const window = await createQuietHours({
      ownerId,
      days,
      start,
      end,
      timezone,
      severityCap: severityCap ?? null,
      createdBy: ownerId,
    })
    return Response.json({ success: true, window }, { status: 201 })
  } catch (err) {
    return jsonError(
      err instanceof Error
        ? err.message
        : 'Failed to create quiet-hours window',
      400
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
  await deleteQuietHours(ownerId, id)
  return Response.json({ success: true })
}

export const Route = createFileRoute('/api/v1/health/quiet-hours')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
