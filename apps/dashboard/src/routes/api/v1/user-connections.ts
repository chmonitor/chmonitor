/**
 * User connections API
 * GET  /api/v1/user-connections — list (metadata only)
 * POST /api/v1/user-connections — create
 */

import { createFileRoute } from '@tanstack/react-router'

import type { LimitCheck } from '@/lib/billing/entitlements'
import type { CreateUserConnectionInput } from '@/lib/connection-store/types'

import { isSourceEngine } from '@chm/types'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { logEvent } from '@/lib/audit/logEvent'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkHostLimit,
  checkHostSoftCap,
  limitMessage,
} from '@/lib/billing/entitlements'
import { recordHostOverage } from '@/lib/billing/host-usage-store'
import { countOwnerHosts } from '@/lib/billing/org-host-count'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { queryConnection } from '@/lib/connection-query/connection-client'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import { ConnectionStoreError } from '@/lib/connection-store/types'
import { emitEvent } from '@/lib/events/outbound-bus'

const ROUTE_GET = { route: '/api/v1/user-connections', method: 'GET' }
const ROUTE_POST = { route: '/api/v1/user-connections', method: 'POST' }

async function handleGet(): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_GET
    )
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const connections = await store.list(userId)
    return createSuccessResponse(
      connections.map((c) => ({
        id: c.id,
        name: c.name,
        host: c.hostUrl,
        user: c.chUser,
        hostId: c.hostId,
        engine: c.engine,
        source: 'database' as const,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))
    )
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_GET)
  }
}

interface CreateRequest {
  name: string
  host: string
  user: string
  password: string
  /** Source engine; omitted/absent defaults to 'clickhouse' in the store. */
  engine?: string
}

/**
 * The 402 response shape for a tripped host-limit check (pre-check or atomic
 * recheck). Both call sites only reach this with a plan that caps hosts, so
 * `check.limit` is always non-null there — but `LimitCheck.limit` is typed
 * `number | null` (it doubles as the unlimited-plan shape), so the caller
 * passes the known-non-null cap explicitly rather than us re-deriving it.
 */
function hostLimitResponse(check: LimitCheck, limit: number): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message: limitMessage(check),
      details: {
        planId: check.planId,
        limit,
        reason: check.reason,
      },
    },
    402,
    ROUTE_POST
  )
}

async function handlePost(request: Request): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_POST
    )
  }

  let body: Partial<CreateRequest>
  try {
    body = (await request.json()) as Partial<CreateRequest>
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_POST
    )
  }

  const { name, host, user, password, engine } = body
  if (
    !name?.trim() ||
    !host?.trim() ||
    !user?.trim() ||
    typeof password !== 'string'
  ) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'name, host, user, and password are required',
      },
      400,
      ROUTE_POST
    )
  }

  // Engine is optional (defaults to 'clickhouse' in the store); when present it
  // must be a known SourceEngine so junk can't reach persistence.
  if (engine !== undefined && !isSourceEngine(engine)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'engine must be one of: clickhouse, clickhouse-cloud, postgres',
      },
      400,
      ROUTE_POST
    )
  }

  const credentials = {
    host: host.trim(),
    user: user.trim(),
    password,
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()

    // Host-limit enforcement FIRST: paid plans cap how many connections a user
    // keeps. plan.hosts === null means unlimited (Enterprise). Checking before
    // the SSRF check + outbound connection test fails fast and avoids opening a
    // network connection to an attacker-supplied host for a request we'll reject.
    //
    // Enforce against the BILLING OWNER's plan (org or user): if the user has an
    // active Clerk org in their session the org's plan determines the limit, and
    // the host count is POOLED across all current org members (countOwnerHosts).
    // For a user owner it's just this user's connections. The count is fail-safe:
    // an org-enumeration error falls back to the acting user's count, so it never
    // blocks a paying org on a Clerk hiccup.
    //
    // This is a UX fast-path only, not the authoritative guard: two concurrent
    // requests (two tabs, or two org members) can both pass this check before
    // either has inserted. The authoritative guard is the atomic INSERT-with-
    // count `store.create()` performs below — see CreateLimitEnforcement.
    // Unlimited plans (plan.hosts === null) skip the count entirely — no
    // Clerk member enumeration needed when there's no cap to check against.
    //
    // SOFT-CAP (plan 18): plans that publish `plan.hostOverage` (Pro/Max) never
    // hard-block past the included allowance — the add is allowed and the extra
    // host is billed as monthly overage (`recordHostOverage` below). Free
    // (`hostOverage: null`) keeps the hard cap. `hardCapLimit` mirrors that split
    // for the atomic store insert: null for soft-capped plans (so a paid owner's
    // pooled count can legitimately exceed `plan.hosts`), the real cap for Free.
    const owner = await resolveBillingOwner()
    const plan = await getPlanForOwner(owner.id)
    const usage =
      plan.hosts != null
        ? await countOwnerHosts(owner, store, userId)
        : { count: 0, memberUserIds: [] as string[] }
    let overageHosts = 0
    let hardCapLimit: number | null = null
    if (plan.hosts != null) {
      const check = checkHostSoftCap(plan, usage.count)
      if (!check.allowed) {
        if (owner.type === 'org') {
          await logEvent({
            orgId: owner.id,
            userId,
            event: 'connection.created',
            action: 'create',
            result: 'denied',
          })
        }
        return hostLimitResponse(checkHostLimit(plan, usage.count), plan.hosts)
      }
      overageHosts = check.overageHosts
      hardCapLimit = plan.hostOverage == null ? plan.hosts : null
    }

    const ssrfError = await validateHostUrl(credentials.host)
    if (ssrfError) {
      return createApiErrorResponse(
        { type: ApiErrorType.ValidationError, message: ssrfError },
        400,
        ROUTE_POST
      )
    }

    try {
      await queryConnection(credentials, 'SELECT 1')
    } catch (err) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.QueryError,
          message:
            err instanceof Error ? err.message : 'Connection test failed',
        },
        400,
        ROUTE_POST
      )
    }

    const input: CreateUserConnectionInput = {
      name: name.trim(),
      hostUrl: credentials.host,
      chUser: credentials.user,
      credentials,
      engine,
    }
    let created
    try {
      created = await store.create(userId, input, {
        memberUserIds: usage.memberUserIds,
        limit: hardCapLimit,
      })
    } catch (err) {
      if (
        err instanceof ConnectionStoreError &&
        err.code === 'LIMIT_EXCEEDED'
      ) {
        // Lost the race: another concurrent request filled the last slot
        // between our fast-path check above and this atomic insert. The
        // store only throws LIMIT_EXCEEDED when it was given a non-null
        // limit — i.e. only for hard-capped (Free) plans, since soft-capped
        // plans pass `hardCapLimit: null` above — so plan.hosts is guaranteed
        // non-null here; `used: plan.hosts` reflects that the pool was already
        // at (or past) the cap when the atomic recheck ran.
        const limit = plan.hosts as number
        return hostLimitResponse(checkHostLimit(plan, limit), limit)
      }
      throw err
    }

    // Meter the over-limit host-month (soft-capped paid plans only —
    // `overageHosts` stays 0 for Free/Enterprise/under-allowance adds).
    // recordHostOverage is fail-open (D1-absent self-host/OSS is a no-op), so
    // this can't fail or block the request.
    if (overageHosts > 0) {
      await recordHostOverage(owner.id, overageHosts)
    }

    if (owner.type === 'org') {
      await logEvent({
        orgId: owner.id,
        userId,
        event: 'connection.created',
        resource: created.id,
        action: 'create',
        result: 'success',
      })
    }

    // Outbound webhook bus (plan 44): fire-and-forget — NOT awaited, so a
    // slow/failing subscriber can never slow or fail this request. emitEvent
    // never throws. See lib/events/outbound-bus.ts's module docblock for why
    // this can't be `waitUntil`-backed instead.
    void emitEvent(userId, {
      id: crypto.randomUUID(),
      type: 'connection.created',
      occurred_at: new Date(created.createdAt).toISOString(),
      data: { id: created.id, name: created.name, hostId: created.hostId },
    })

    return createSuccessResponse({
      id: created.id,
      name: created.name,
      host: created.hostUrl,
      user: created.chUser,
      hostId: created.hostId,
      engine: created.engine,
      source: 'database' as const,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_POST)
  }
}

export const Route = createFileRoute('/api/v1/user-connections')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
