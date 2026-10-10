/**
 * PeerDB alert rules CRUD (#3699)
 * GET    /api/v1/health/peerdb-rules        — list rules (DB + alerts.yaml)
 * POST   /api/v1/health/peerdb-rules        — create (no `id`) or update a rule
 * DELETE /api/v1/health/peerdb-rules?id=... — delete a rule
 *
 * Auth and owner resolution mirror `maint-windows.ts`: GET rides the global
 * /api/v1 gate, writes self-enforce the `settings` write permission, and a
 * deployment without Clerk is the OSS single-tenant owner (`''`) — the same
 * owner the health sweep reads. Declarative (`alerts.yaml`/env) rules are
 * read-only here: edit the file instead.
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { resolveBillingOwnerId } from '@/lib/billing/billing-owner'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { peerDBRuleFieldsSchema } from '@/lib/peerdb/alert-rules'
import {
  deletePeerDBRule,
  listPeerDBRules,
  savePeerDBRule,
} from '@/lib/peerdb/alert-rules-store'

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

const SaveRuleSchema = z.intersection(
  peerDBRuleFieldsSchema,
  z.object({
    id: z.string().min(1).max(128).optional(),
    muteUntil: z.number().int().nonnegative().nullable().default(null),
  })
)

async function authorizeWrite(request: Request): Promise<Response | null> {
  return authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
}

async function isDeclarative(ownerId: string, id: string): Promise<boolean> {
  const rules = await listPeerDBRules(ownerId)
  return rules.some((r) => r.id === id && r.source !== 'd1')
}

async function handleGet(): Promise<Response> {
  const rules = await listPeerDBRules(await resolveOwnerId())
  return Response.json({ success: true, rules })
}

async function handlePost(request: Request): Promise<Response> {
  const denied = await authorizeWrite(request)
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }
  const parsed = SaveRuleSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(
      `Invalid request body: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    )
  }

  const ownerId = await resolveOwnerId()
  const { id, ...fields } = parsed.data
  if (id && (await isDeclarative(ownerId, id))) {
    return jsonError('This rule is defined in alerts.yaml; edit the file', 409)
  }
  try {
    const rule = await savePeerDBRule(ownerId, {
      ...fields,
      id: id ?? crypto.randomUUID(),
    })
    return Response.json({ success: true, rule }, { status: id ? 200 : 201 })
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : 'Failed to save PeerDB rule',
      500
    )
  }
}

async function handleDelete(request: Request): Promise<Response> {
  const denied = await authorizeWrite(request)
  if (denied) return denied

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return jsonError('Missing "id" query parameter', 400)

  const ownerId = await resolveOwnerId()
  if (await isDeclarative(ownerId, id)) {
    return jsonError('This rule is defined in alerts.yaml; edit the file', 409)
  }
  try {
    await deletePeerDBRule(ownerId, id)
    return Response.json({ success: true })
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : 'Failed to delete PeerDB rule',
      500
    )
  }
}

export const Route = createFileRoute('/api/v1/health/peerdb-rules')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
