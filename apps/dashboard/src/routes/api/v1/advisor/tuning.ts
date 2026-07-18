/**
 * Advisor auto fine-tune endpoint
 *
 * Scans a database (or single table) and returns ranked, recommend-only schema
 * lint + settings tuning findings. See `@/lib/ai/advisor/tuning/tuning-engine`
 * and issue #2764 — this route never executes or applies anything; it runs the
 * read-only engine and returns its result.
 *
 *   GET  /api/v1/advisor/tuning?hostId=0&database=default
 *   GET  /api/v1/advisor/tuning?hostId=0&database=default&table=events
 *
 * Meters each invocation against the same daily AI-request allowance as the
 * query advisor (`routes/api/v1/advisor.ts`) — one run consumes one of the
 * plan's `aiRequestsPerDay`. Fails open when Clerk/billing isn't configured, so
 * self-hosted deployments stay whole.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'

const ROUTE_CONTEXT = { route: '/api/v1/advisor/tuning' }

/**
 * Reserve one daily AI-request unit for the signed-in owner, mirroring
 * `routes/api/v1/advisor.ts`. Returns `null` blocked when enforcement doesn't
 * apply (self-hosted / no Clerk owner — fails open).
 */
async function reserveTuningUsage(): Promise<{
  ownerId: string | null
  reserved: boolean
  blocked: {
    message: string
    planId: string
    limit: number | null
    reason: string
  } | null
}> {
  try {
    const { resolveBillingOwner } = await import('@/lib/billing/billing-owner')
    const { getPlanForOwner } = await import('@/lib/billing/user-subscription')
    const { checkAiDailyLimit, limitMessage } = await import(
      '@/lib/billing/entitlements'
    )
    const { reserveAiUsage, releaseAiUsage } = await import(
      '@/lib/billing/ai-usage-store'
    )

    const owner = await resolveBillingOwner()
    const plan = await getPlanForOwner(owner.id)

    if (plan.aiRequestsPerDay == null) {
      return { ownerId: owner.id, reserved: false, blocked: null }
    }

    const reservedCount = await reserveAiUsage(owner.id)
    if (reservedCount == null) {
      return { ownerId: owner.id, reserved: false, blocked: null }
    }

    const check = checkAiDailyLimit(plan, reservedCount - 1)
    if (!check.allowed) {
      await releaseAiUsage(owner.id)
      return {
        ownerId: owner.id,
        reserved: false,
        blocked: {
          message: limitMessage(check),
          planId: check.planId,
          limit: check.limit ?? plan.aiRequestsPerDay,
          reason: check.reason,
        },
      }
    }

    return { ownerId: owner.id, reserved: true, blocked: null }
  } catch {
    return { ownerId: null, reserved: false, blocked: null }
  }
}

async function releaseTuningUsage(ownerId: string | null): Promise<void> {
  if (!ownerId) return
  try {
    const { releaseAiUsage } = await import('@/lib/billing/ai-usage-store')
    await releaseAiUsage(ownerId)
  } catch {
    // best-effort rollback only
  }
}

async function runTuning(
  hostId: number,
  database: string | null,
  table: string | null
): Promise<Response> {
  if (!database || database.trim() === '') {
    return Response.json(
      {
        success: false,
        error: 'Missing required parameter: database',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  // Cloud demo-hiding invariant (mirrors advisor.ts): a non-negative id from a
  // signed-in cloud principal can only be the hidden env/demo host.
  if (
    await isDemoHostBlockedForRequest(
      hostId,
      env as Record<string, string | undefined>
    )
  ) {
    return Response.json(
      {
        success: true,
        findings: [],
        ...ROUTE_CONTEXT,
        unavailable: demoHiddenUnavailable(),
      },
      { status: 200 }
    )
  }

  const { ownerId, reserved, blocked } = await reserveTuningUsage()
  if (blocked) {
    return Response.json(
      {
        success: false,
        error: blocked.message,
        details: {
          planId: blocked.planId,
          limit: blocked.limit,
          reason: blocked.reason,
        },
        ...ROUTE_CONTEXT,
      },
      { status: 402 }
    )
  }

  try {
    const { analyzeTuning } = await import(
      '@/lib/ai/advisor/tuning/tuning-engine'
    )
    const result = await analyzeTuning({
      hostId,
      database,
      table: table ?? undefined,
    })

    if (!result.ok) {
      if (reserved) await releaseTuningUsage(ownerId)
      return Response.json(
        { success: false, error: result.error, ...ROUTE_CONTEXT },
        { status: 400 }
      )
    }

    return Response.json(
      { success: true, ...result, ...ROUTE_CONTEXT },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    )
  } catch (err) {
    if (reserved) await releaseTuningUsage(ownerId)
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        ...ROUTE_CONTEXT,
      },
      { status: 500 }
    )
  }
}

function getAndValidateHostId(
  searchParams: URLSearchParams
): number | { message: string } {
  const raw = searchParams.get('hostId')
  if (!raw || raw.trim() === '')
    return { message: 'Missing required parameter: hostId' }
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 0) {
    return { message: 'hostId must be a non-negative integer' }
  }
  return n
}

export const Route = createFileRoute('/api/v1/advisor/tuning')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)
        const { searchParams } = new URL(request.url)

        const hostIdResult = getAndValidateHostId(searchParams)
        if (typeof hostIdResult !== 'number') {
          return Response.json(
            { success: false, error: hostIdResult.message, ...ROUTE_CONTEXT },
            { status: 400 }
          )
        }

        return runTuning(
          hostIdResult,
          searchParams.get('database'),
          searchParams.get('table')
        )
      },
    },
  },
})

export { runTuning as __runTuningForTests }
