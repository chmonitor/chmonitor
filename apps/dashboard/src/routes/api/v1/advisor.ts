/**
 * Query advisor endpoint
 *
 * Analyzes a slow query (by `sql` or `queryId`) and returns ranked,
 * recommend-only DDL/rewrite suggestions. See
 * `@/lib/ai/advisor/recommendation-engine` and
 * plans/46-query-advisor-engine.md — this route never executes or applies
 * anything, it only runs the (read-only) engine and returns its result.
 *
 *   GET  /api/v1/advisor?hostId=0&sql=SELECT...
 *   GET  /api/v1/advisor?hostId=0&queryId=...&database=default
 *   POST /api/v1/advisor   { "hostId": 0, "sql": "SELECT ...", "database": "default" }
 *
 * Meters each invocation against the same daily AI-request allowance used by
 * the agent chat route (`routes/api/v1/agent.ts`) — one advisor run consumes
 * one of the plan's `aiRequestsPerDay`. Fails open (no enforcement) when
 * Clerk/billing isn't configured, so self-hosted deployments stay whole.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'

const ROUTE_CONTEXT = { route: '/api/v1/advisor' }
const MAX_QUERY_LENGTH = 100000

/**
 * Reserve one daily AI-request unit for the signed-in owner, mirroring
 * `routes/api/v1/agent.ts`'s enforcement block. Returns `null` when
 * enforcement doesn't apply (self-hosted / no Clerk owner — fails open) or a
 * `{ blocked }` result when the plan's daily allowance is exhausted.
 *
 * Only meters the request-count allowance (not the monthly USD budget): the
 * advisor performs no LLM generation, so there is no real token spend to
 * charge — inventing a dollar figure for `addAiSpend` would misrepresent that
 * meter. Counting it as one AI request against `aiRequestsPerDay` is the
 * honest fit for "premium AI usage".
 */
async function reserveAdvisorUsage(): Promise<{
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
      // D1 unavailable — fail open, same as agent.ts.
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
    // Not cloud / no Clerk owner — self-hosted stays whole.
    return { ownerId: null, reserved: false, blocked: null }
  }
}

async function releaseAdvisorUsage(ownerId: string | null): Promise<void> {
  if (!ownerId) return
  try {
    const { releaseAiUsage } = await import('@/lib/billing/ai-usage-store')
    await releaseAiUsage(ownerId)
  } catch {
    // best-effort rollback only
  }
}

async function runAdvisor(
  hostId: number,
  sql: string | null,
  queryId: string | null,
  database: string | null
): Promise<Response> {
  if ((!sql || sql.trim() === '') && (!queryId || queryId.trim() === '')) {
    return Response.json(
      {
        success: false,
        error: 'Provide either `sql` or `queryId`.',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  if (sql && sql.length > MAX_QUERY_LENGTH) {
    return Response.json(
      {
        success: false,
        error: `Query is too long (maximum ${MAX_QUERY_LENGTH} characters)`,
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  const { ownerId, reserved, blocked } = await reserveAdvisorUsage()
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
    const { analyzeQuery } = await import(
      '@/lib/ai/advisor/recommendation-engine'
    )
    const result = await analyzeQuery({
      hostId,
      sql: sql ?? undefined,
      queryId: queryId ?? undefined,
      database: database ?? undefined,
    })

    if (!result.ok) {
      if (reserved) await releaseAdvisorUsage(ownerId)
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
    if (reserved) await releaseAdvisorUsage(ownerId)
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

export const Route = createFileRoute('/api/v1/advisor')({
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

        return runAdvisor(
          hostIdResult,
          searchParams.get('sql'),
          searchParams.get('queryId'),
          searchParams.get('database')
        )
      },

      POST: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            {
              success: false,
              error: 'Request body must be valid JSON',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        if (body === null || Array.isArray(body) || typeof body !== 'object') {
          return Response.json(
            {
              success: false,
              error: 'Request body must be a JSON object',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        const { hostId, sql, queryId, database } = body as Record<
          string,
          unknown
        >

        if (hostId === undefined || hostId === null || hostId === '') {
          return Response.json(
            {
              success: false,
              error: 'Missing required parameter: hostId',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        const hostIdResult = getAndValidateHostId(
          new URLSearchParams({ hostId: String(hostId) })
        )
        if (typeof hostIdResult !== 'number') {
          return Response.json(
            { success: false, error: hostIdResult.message, ...ROUTE_CONTEXT },
            { status: 400 }
          )
        }

        return runAdvisor(
          hostIdResult,
          typeof sql === 'string' ? sql : null,
          typeof queryId === 'string' ? queryId : null,
          typeof database === 'string' ? database : null
        )
      },
    },
  },
})

export { runAdvisor as __runAdvisorForTests }
