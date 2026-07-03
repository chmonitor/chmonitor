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
 * ACK scope: every ACK is stored under the single OSS-tenant owner id (`''`)
 * — see `ACK_OWNER_ID` below for why (the sweep is an operator-level cron
 * with no per-request user context, so it can only ever read `''`; scoping
 * ACKs to a resolved billing owner would make the panel show "acked" while
 * the sweep keeps dispatching). `resolveBillingOwner()` is only used for the
 * `ackedBy` attribution, wrapped in try/catch so a Clerk-less/self-hosted
 * deployment degrades to `ackedBy='operator'` rather than failing the
 * request. Writes (POST/DELETE) are gated behind the 'health' feature
 * permission so an anonymous caller on a Clerk-public-read cloud deployment
 * cannot mutate ACK state; GET is left to the centralized /api/v1 middleware
 * like the sibling history/snapshot routes.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  ackAlert,
  clearAck,
  isAckDurationKey,
  listActiveAcks,
} from '@/lib/health/alert-ack-store'

const ROUTE_CONTEXT = { route: '/api/v1/health/ack' } as const

/**
 * ACK scope. The health sweep (`server-sweep.ts`) is an operator-level cron
 * over env-configured `CLICKHOUSE_*` hosts with no per-request user context —
 * it can only ever read `listActiveAcks('')`. If this route wrote ACKs under
 * a resolved billing-owner id (org/user), a cloud deployment's panel would
 * show "acked" while the sweep, scoped to `''`, never sees it and still
 * dispatches the webhook. So every ACK is stored under the single OSS-tenant
 * scope `''` regardless of auth — the resolved identity is only used for the
 * `ackedBy` attribution, never for D1 row scoping. Multi-tenant ACK scoping
 * (per-org suppression matching a per-org sweep) is out of scope here; see
 * plans/29-alert-ack-manual-resolution.md.
 */
const ACK_OWNER_ID = ''

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
      ownerId: ACK_OWNER_ID,
      hostId,
      ruleId,
      durationKey: duration,
      ackedBy: actor,
      note,
    })
    return Response.json({ success: true, ack }, { status: 200 })
  } catch (err) {
    error('[POST /api/v1/health/ack] Failed to record ACK', err as Error)
    return createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: err instanceof Error ? err.message : 'Failed to record ACK',
      },
      500,
      { ...ROUTE_CONTEXT, method: 'POST' }
    )
  }
}

async function handleGet(): Promise<Response> {
  const acks = await listActiveAcks(ACK_OWNER_ID)
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

  await clearAck(ACK_OWNER_ID, hostId, ruleId)
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
