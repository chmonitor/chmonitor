/**
 * Alert ACK / manual resolution endpoint (plan 29)
 * POST   /api/v1/health/ack   — ACK/snooze a condition for a chosen duration
 * GET    /api/v1/health/ack   — list currently-active acks (feeds the panel)
 * DELETE /api/v1/health/ack   — clear an ACK early (manual un-ACK)
 *
 * An ACK on a `(hostId, ruleId)` condition tells the health sweep
 * (`lib/health/server-sweep.ts`) to suppress its notification dispatch for a
 * bounded, whitelisted duration (5/15/60/240 minutes) — it does NOT touch the
 * underlying dedup state (`alert-state-store.ts`) or run any cluster action;
 * it is purely a post-decision notification gate.
 *
 * ACK scope: self-hosted stores every ACK under the single-tenant owner
 * (`''`), the owner the health sweep reads, so an ACK there suppresses
 * notifications. Cloud stores ACKs under the signed-in billing owner and
 * answers 401 without one (see `resolveAckOwner`). The sweep never reads those
 * owners, so in cloud an ACK is display-only: it marks the finding in the
 * panel and suppresses nothing.
 * `resolveBillingOwner()` also gives the `ackedBy` attribution, degrading to
 * `ackedBy='operator'` on a Clerk-less deployment. Writes (POST/DELETE) are gated behind the 'health' feature
 * permission so an anonymous caller on a Clerk-public-read cloud deployment
 * cannot mutate ACK state.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error } from '@chm/logger'
import { createInternalErrorResponse } from '@/lib/api/error-handler'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  ackAlert,
  clearAck,
  isAckDurationKey,
  listActiveAcks,
} from '@/lib/health/alert-ack-store'
import { resolveHealthBackend } from '@/lib/health/resolve-store'

const ROUTE_CONTEXT = { route: '/api/v1/health/ack' } as const

/**
 * Self-hosted ACK scope. The health sweep (`server-sweep.ts`) is an
 * operator-level cron over env-configured `CLICKHOUSE_*` hosts with no
 * per-request user context, so it reads `listActiveAcks('')`. Self-hosted ACKs
 * are stored there so the panel and the sweep agree.
 */
const SELF_HOSTED_ACK_OWNER_ID = ''

/**
 * The owner an ACK is stored and read under. Self-hosted: the single-tenant
 * `''`, which the sweep reads. Cloud: the signed-in billing owner (org or
 * user), so tenants never see each other's ACKs; with no signed-in owner the
 * caller gets 401. Cloud ACKs are display-only because the sweep reads `''`.
 */
async function resolveAckOwner(
  method: 'GET' | 'POST' | 'DELETE'
): Promise<string | Response> {
  if (!isCloudModeServer()) return SELF_HOSTED_ACK_OWNER_ID
  try {
    return (await resolveBillingOwner()).id
  } catch {
    return createErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'Sign in to view or change alert acknowledgements',
      },
      401,
      { ...ROUTE_CONTEXT, method }
    )
  }
}

/**
 * Resolve the ACK actor for `ackedBy` attribution. Fails open to
 * `'operator'` when Clerk is unavailable or the session can't be resolved —
 * an ACK is a low-stakes, bounded-duration notification suppression, not a
 * destructive action, so we never block the operation over identity.
 */
async function resolveAckActor(): Promise<string> {
  try {
    const owner = await resolveBillingOwner()
    return owner.id
  } catch {
    return 'operator'
  }
}

interface AckRequestBody {
  hostId?: unknown
  ruleId?: unknown
  duration?: unknown
  note?: unknown
}

/**
 * Writes are honest (#3498): with no D1/Postgres backend an ACK or un-ACK
 * would be discarded, so say so with a 501 instead of confirming a write that
 * never happened. Reads stay fail-open (an empty list).
 */
function notConfiguredResponse(method: 'POST' | 'DELETE'): Response | null {
  if (resolveHealthBackend() !== null) return null
  return createErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message:
        'No alert state backend configured. Acknowledging alerts requires a D1 binding (CHM_CLOUD_D1) or a Postgres DATABASE_URL.',
    },
    501,
    { ...ROUTE_CONTEXT, method }
  )
}

function validationError(message: string): Response {
  return createErrorResponse(
    { type: ApiErrorType.ValidationError, message },
    400,
    { ...ROUTE_CONTEXT, method: 'POST' }
  )
}

async function handlePost(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'health', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse
  const notConfigured = notConfiguredResponse('POST')
  if (notConfigured) return notConfigured
  const ownerId = await resolveAckOwner('POST')
  if (ownerId instanceof Response) return ownerId

  let body: AckRequestBody
  try {
    body = (await request.json()) as AckRequestBody
  } catch {
    return validationError('Request body must be valid JSON')
  }

  const { hostId, ruleId, duration, note } = body

  if (typeof hostId !== 'number' || !Number.isInteger(hostId) || hostId < 0) {
    return validationError('Missing or invalid "hostId": expected an integer')
  }
  if (typeof ruleId !== 'string' || ruleId.trim().length === 0) {
    return validationError('Missing or invalid "ruleId": expected a string')
  }
  if (typeof duration !== 'string' || !isAckDurationKey(duration)) {
    return validationError(
      'Missing or invalid "duration": expected one of "5m", "15m", "60m", "240m"'
    )
  }
  if (note !== undefined && typeof note !== 'string') {
    return validationError('Invalid "note": expected a string')
  }

  const actor = await resolveAckActor()

  try {
    const ack = await ackAlert({
      ownerId,
      hostId,
      ruleId,
      durationKey: duration,
      ackedBy: actor,
      note,
    })
    return Response.json({ success: true, ack }, { status: 200 })
  } catch (err) {
    error('[POST /api/v1/health/ack] Failed to record ACK', err as Error)
    return createInternalErrorResponse(err, {
      ...ROUTE_CONTEXT,
      method: 'POST',
    })
  }
}

async function handleGet(): Promise<Response> {
  const ownerId = await resolveAckOwner('GET')
  if (ownerId instanceof Response) return ownerId
  const acks = await listActiveAcks(ownerId)
  return Response.json(
    { success: true, acks },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=0' },
    }
  )
}

async function handleDelete(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'health', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse
  const notConfigured = notConfiguredResponse('DELETE')
  if (notConfigured) return notConfigured
  const ownerId = await resolveAckOwner('DELETE')
  if (ownerId instanceof Response) return ownerId

  const { searchParams } = new URL(request.url)
  const hostIdParam = searchParams.get('hostId')
  const ruleId = searchParams.get('ruleId')

  const hostId = Number(hostIdParam)
  if (!hostIdParam || !Number.isInteger(hostId) || hostId < 0) {
    return createErrorResponse(
      { type: ApiErrorType.ValidationError, message: 'Invalid hostId' },
      400,
      { ...ROUTE_CONTEXT, method: 'DELETE' }
    )
  }
  if (!ruleId) {
    return createErrorResponse(
      { type: ApiErrorType.ValidationError, message: 'Missing ruleId' },
      400,
      { ...ROUTE_CONTEXT, method: 'DELETE' }
    )
  }

  await clearAck(ownerId, hostId, ruleId)
  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/ack')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})

// Exported for unit tests only.
export {
  handlePost as __handlePostForTests,
  handleGet as __handleGetForTests,
  handleDelete as __handleDeleteForTests,
}
