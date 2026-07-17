/**
 * Regression for issue #2675: the daily AI-message reservation must be
 * RELEASED when agent construction throws before any stream exists.
 *
 * `POST /api/v1/agent` reserves one daily-quota slot up front
 * (`reserveAiUsage`) and rolls it back on failure via
 * `releaseReservationOnce`. That release used to be wired only into the
 * stream's `execute`/`onError`/`onEnd` — none of which run when
 * `createClickHouseAgent(...)` throws pre-stream (bad model id, broken
 * custom-MCP tool merge, invalid BYOK key, ...), so every such failure
 * permanently burned one of a Free-tier user's daily messages.
 *
 * These tests drive the real route handler with everything external mocked,
 * force `createClickHouseAgent` to throw, and assert the reservation is
 * released exactly once (and never released when nothing was reserved).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

// --- rate limiting / auth: always allow -------------------------------------
mock.module('@/lib/api/rate-limiter', () => ({
  checkRateLimitDurable: async () => ({ allowed: true }),
  clientIpKey: () => 'test-ip',
  getAgentRateLimitPerMin: () => 1000,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}))
mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: () => {},
}))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: async () => null,
}))
mock.module('@/lib/auth/provider', () => ({
  isClerkAuthProvider: () => false,
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))

// --- model/provider resolution: always configured ----------------------------
mock.module('@/lib/ai/providers', () => ({
  parseModelId: () => ({ provider: 'test', model: 'test-model' }),
  isProviderConfigured: () => true,
  getProviderName: () => 'Test Provider',
}))
mock.module('@/lib/ai/agent-model-registry', () => ({
  resolveDefaultAgentModel: () => 'test/test-model',
}))

// --- custom MCP servers: none ------------------------------------------------
mock.module('@/lib/ai/agent/mcp/connect-custom-servers', () => ({
  loadUserRegisteredServers: async () => [],
  mergeMcpServers: () => [],
  connectCustomMcpServers: async () => ({
    tools: {},
    closeAll: async () => {},
    statuses: [],
  }),
}))

// --- billing: cloud-mode owner on a capped plan ------------------------------
const OWNER_ID = 'owner-quota-test'

mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: async () => ({ id: OWNER_ID }),
}))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: async () => ({
    id: 'free',
    aiRequestsPerDay: 5,
    aiMonthlyUsdBudget: null,
  }),
}))
mock.module('@/lib/billing/entitlements', () => ({
  checkAiDailyLimit: () => ({ allowed: true }),
  checkAiBudget: () => ({ allowed: true }),
  limitMessage: () => 'limit reached',
}))

// reserveAiUsage returns the post-increment count (a reservation was made)
// unless a test overrides it to return null (no D1 → no reservation).
let reserveResult: number | null = 1
const reserveAiUsage = mock(async () => reserveResult)
const releaseAiUsage = mock(async () => {})

mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage,
  releaseAiUsage,
  getAiSpendThisMonth: async () => 0,
  meterAiOverage: async () => {},
  recordByokActivation: async () => {},
}))

// --- the agent factory under test: throws pre-stream -------------------------
const createClickHouseAgent = mock(() => {
  throw new Error('boom: agent construction failed')
})
mock.module('@/lib/ai/agent', () => ({ createClickHouseAgent }))

const { Route } = await import('@/routes/api/v1/agent')

async function postAgent(): Promise<Response> {
  const handlers = (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (ctx: { request: Request }) => Promise<Response>
        }
      }
    }
  ).server.handlers
  return handlers.POST({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', model: 'test/test-model' }),
    }),
  })
}

describe('POST /api/v1/agent — daily-quota reservation on pre-stream failure (#2675)', () => {
  beforeEach(() => {
    reserveResult = 1
    reserveAiUsage.mockClear()
    releaseAiUsage.mockClear()
    createClickHouseAgent.mockClear()
  })

  test('releases the reservation when createClickHouseAgent throws', async () => {
    const res = await postAgent()

    // The outer boundary converts the throw into a structured JSON error.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(createClickHouseAgent).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledWith(OWNER_ID)
  })

  test('does not release when nothing was reserved (no D1 counter)', async () => {
    reserveResult = null

    const res = await postAgent()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(createClickHouseAgent).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).not.toHaveBeenCalled()
  })
})
