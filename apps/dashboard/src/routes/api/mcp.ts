import { createFileRoute } from '@tanstack/react-router'

import { corsPreflight, handleMcp, withCors } from '@chm/mcp-server/http'
import {
  checkRateLimitDurable,
  clientIpKey,
  getMcpRateLimitPerMin,
  RATE_LIMIT_BINDING_MCP,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { requirePlanCapability } from '@/lib/billing/plan-capability'

/**
 * In-process MCP endpoint — thin re-point of the Next `app/api/mcp/route.ts`.
 *
 * Transport/auth/CORS live in `@chm/mcp-server/http`, shared with the standalone
 * Cloudflare MCP Worker (`apps/mcp`). Each method forwards the Web `Request` to
 * `handleMcp`; OPTIONS answers CORS preflight so cross-origin MCP clients work
 * against the in-process route too (parity with the Worker).
 *
 * Plan gate: POST and GET require the `api_mcp_access` capability (Max / Enterprise).
 * Self-hosted deployments are never gated — the capability check short-circuits to
 * null (allow) whenever billing context is unavailable. See lib/billing/plan-capability.ts.
 *
 * Rate limiting (#2704): reuses the same `checkRateLimitDurable` pattern already
 * guarding the agent's SQL-executing route (routes/api/v1/agent.ts) — /api/mcp
 * exposes the same class of capability (arbitrary read-only SQL via the `query`
 * tool, plus 10 other ClickHouse-querying tools) over a differently-authenticated
 * transport. Checked per-IP, before auth, on every verb: the resolved identity
 * (API-key `sub` / Clerk user id) is only known inside `defaultAuthenticator`,
 * which lives in the SDK-free `@chm/mcp-server` package (shared with the
 * standalone apps/mcp Worker and forbidden by dependency-cruiser from depending
 * on any apps/* package), so it cannot reuse this app's rate limiter. An
 * IP-keyed check still bounds the exact abuse the issue calls out — unthrottled
 * `tools/call` bursts, including the `CHM_MCP_PUBLIC=true` anonymous mode.
 */
async function checkMcpRateLimit(request: Request): Promise<Response | null> {
  const ip = clientIpKey(request)
  const rl = await checkRateLimitDurable(
    `mcp:ip:${ip}`,
    getMcpRateLimitPerMin(),
    RATE_LIMIT_BINDING_MCP
  )
  return rl.allowed ? null : withCors(rateLimitResponse(rl.retryAfterSec))
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await checkMcpRateLimit(request)
        if (limited) return limited
        const denied = await requirePlanCapability('api_mcp_access', request)
        if (denied) return denied
        return handleMcp(request)
      },
      GET: async ({ request }) => {
        const limited = await checkMcpRateLimit(request)
        if (limited) return limited
        const denied = await requirePlanCapability('api_mcp_access', request)
        if (denied) return denied
        return handleMcp(request)
      },
      DELETE: async ({ request }) => {
        const limited = await checkMcpRateLimit(request)
        if (limited) return limited
        return handleMcp(request)
      },
      OPTIONS: () => corsPreflight(),
    },
  },
})

// Exported for unit tests (`__tests__/mcp-rate-limit.test.ts`), which exercise
// this guard directly rather than routing through the TanStack Router.
export { checkMcpRateLimit as __checkMcpRateLimitForTests }
