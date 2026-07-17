/**
 * Request-level test suite for `POST /api/v1/agent` (issue #2677).
 *
 * `agent.ts` is the single entry point for the AI agent chat — the dashboard's
 * flagship AI feature — and combines auth, rate limiting, Clerk billing-owner
 * resolution, the daily-message and monthly-USD-budget gates (real
 * money/entitlement logic), custom MCP server connect/close lifecycle, and the
 * streaming agent invocation itself. Despite that density there was no
 * dedicated test file for the route handler (only `agent-page-context.test.ts`,
 * which exercises a narrow pure-helper, and
 * `__tests__/agent-quota-release.test.ts`, which only covers the
 * reservation-release-on-throw regression for #2675). This file drives the
 * real route handler end to end with every external dependency mocked,
 * prioritised by risk:
 *
 *   1. AUTH    — unauthenticated/rate-limited rejected; valid accepted.
 *   2. MONEY   — daily-quota + monthly-budget gates, BYOK bypass, MCP-close +
 *                reservation-release on a pre-stream throw (locks in #2675
 *                more completely than the existing sibling test — that one
 *                never has any MCP servers connected, so it never exercises
 *                the `mcpCloseAll()` call), and reservation release on a
 *                mid-stream agent failure.
 *   3. VALIDATION — malformed JSON, missing message, too many messages,
 *                oversized payload.
 *   4. ERRORS  — provider-not-configured (503) and the outer error boundary
 *                that converts an uncaught pre-stream throw into a structured
 *                JSON error.
 *
 * Mocking strategy mirrors `__tests__/agent-quota-release.test.ts`: every
 * module `agent.ts` imports is stubbed with `mock.module()` BEFORE the route
 * module is dynamically imported, so Bun's module registry sees the stubs.
 * `classifyError` (`@/lib/ai/agent/errors`) is intentionally left real, same
 * as the sibling test, so assertions on response shape/status exercise the
 * actual classification logic.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

// --- rate limiting / auth ----------------------------------------------------
let authGateResponse: Response | null = null
let ipRateLimitAllowed = true
let ipRetryAfterSec = 30

const checkRateLimitDurable = mock(async () =>
  ipRateLimitAllowed
    ? { allowed: true as const }
    : { allowed: false as const, retryAfterSec: ipRetryAfterSec }
)
const authorizeAgentApiRequest = mock(async () => authGateResponse)

mock.module('@/lib/api/rate-limiter', () => ({
  checkRateLimitDurable,
  clientIpKey: () => 'test-ip',
  getAgentRateLimitPerMin: () => 1000,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: (retryAfterSec: number) =>
    new Response(JSON.stringify({ error: 'rate limited', retryAfterSec }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
}))
mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: () => {},
}))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest,
}))
mock.module('@/lib/auth/provider', () => ({
  isClerkAuthProvider: () => false,
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))

// --- model/provider resolution ------------------------------------------------
let providerConfigured = true
mock.module('@/lib/ai/providers', () => ({
  parseModelId: () => ({ provider: 'test', model: 'test-model' }),
  isProviderConfigured: () => providerConfigured,
  getProviderName: () => 'Test Provider',
}))
mock.module('@/lib/ai/agent-model-registry', () => ({
  resolveDefaultAgentModel: () => 'test/test-model',
}))

// --- custom MCP servers -------------------------------------------------------
let mergedServersResult: Array<{ id: string; name: string; endpoint: string }> =
  []
const mcpCloseAll = mock(async () => {})
const connectCustomMcpServers = mock(async () => ({
  tools: {},
  closeAll: mcpCloseAll,
  statuses: [{ id: 's1', status: 'connected' as const, toolCount: 0 }],
}))
mock.module('@/lib/ai/agent/mcp/connect-custom-servers', () => ({
  loadUserRegisteredServers: async () => [],
  mergeMcpServers: () => mergedServersResult,
  connectCustomMcpServers,
}))

// --- billing: cloud-mode owner + plan -----------------------------------------
const OWNER_ID = 'owner-agent-route-test'
const resolveBillingOwner = mock(async () => ({ id: OWNER_ID }))
mock.module('@/lib/billing/billing-owner', () => ({ resolveBillingOwner }))

let planAiRequestsPerDay: number | null = 5
let planAiMonthlyUsdBudget: number | null = null
const getPlanForOwner = mock(async () => ({
  id: 'free',
  aiRequestsPerDay: planAiRequestsPerDay,
  aiMonthlyUsdBudget: planAiMonthlyUsdBudget,
}))
mock.module('@/lib/billing/user-subscription', () => ({ getPlanForOwner }))

let dailyCheckAllowed = true
let budgetCheckAllowed = true
mock.module('@/lib/billing/entitlements', () => ({
  checkAiDailyLimit: () => ({
    allowed: dailyCheckAllowed,
    reason: 'ai_daily_limit',
    planId: 'free',
    limit: planAiRequestsPerDay,
  }),
  checkAiBudget: () => ({
    allowed: budgetCheckAllowed,
    reason: 'ai_budget_limit',
    planId: 'free',
    limit: planAiMonthlyUsdBudget,
  }),
  limitMessage: () => 'limit reached',
}))

let reserveResult: number | null = 1
const reserveAiUsage = mock(async () => reserveResult)
const releaseAiUsage = mock(async () => {})
const getAiSpendThisMonth = mock(async () => 0)
const meterAiOverage = mock(async () => {})
const recordByokActivation = mock(async () => {})
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage,
  releaseAiUsage,
  getAiSpendThisMonth,
  meterAiOverage,
  recordByokActivation,
}))

// --- the agent factory under test --------------------------------------------
// Default: throws pre-stream (same shape as agent-quota-release.test.ts). Tests
// that need a streaming agent override `createAgentImpl` to return a fake
// ToolLoopAgent-shaped object with a `.stream()` method.
let createAgentImpl: () => unknown = () => {
  throw new Error('boom: agent construction failed')
}
const createClickHouseAgent = mock((_opts: Record<string, unknown>) =>
  createAgentImpl()
)
mock.module('@/lib/ai/agent', () => ({ createClickHouseAgent }))

const { Route } = await import('@/routes/api/v1/agent')

// --- test helpers --------------------------------------------------------------

function getHandler(): (ctx: { request: Request }) => Promise<Response> {
  return (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (ctx: { request: Request }) => Promise<Response>
        }
      }
    }
  ).server.handlers.POST
}

async function postAgent(
  body: Record<string, unknown> = { message: 'hello', model: 'test/test-model' }
): Promise<Response> {
  return getHandler()({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

async function postAgentRaw(
  text: string,
  headers: Record<string, string> = { 'content-type': 'application/json' }
): Promise<Response> {
  return getHandler()({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers,
      body: text,
    }),
  })
}

/**
 * Fully drain a streaming Response body. `createUIMessageStream`'s `execute`
 * callback runs concurrently with the Response being returned (it starts as
 * soon as the underlying ReadableStream is constructed) and the stream's
 * `controller.close()` only fires once `execute` has fully settled — including
 * any awaited cleanup inside its catch block (e.g. `releaseReservationOnce`).
 * Draining the body to `done` is therefore the only reliable way to observe
 * side effects that happen *inside* the stream from outside the handler.
 */
async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) return
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

function resetAllMocks(): void {
  authGateResponse = null
  ipRateLimitAllowed = true
  ipRetryAfterSec = 30
  providerConfigured = true
  mergedServersResult = []
  planAiRequestsPerDay = 5
  planAiMonthlyUsdBudget = null
  dailyCheckAllowed = true
  budgetCheckAllowed = true
  reserveResult = 1
  createAgentImpl = () => {
    throw new Error('boom: agent construction failed')
  }

  checkRateLimitDurable.mockClear()
  authorizeAgentApiRequest.mockClear()
  connectCustomMcpServers.mockClear()
  mcpCloseAll.mockClear()
  resolveBillingOwner.mockClear()
  getPlanForOwner.mockClear()
  reserveAiUsage.mockClear()
  releaseAiUsage.mockClear()
  getAiSpendThisMonth.mockClear()
  meterAiOverage.mockClear()
  recordByokActivation.mockClear()
  createClickHouseAgent.mockClear()
}

// --- 1. AUTH -------------------------------------------------------------------

describe('POST /api/v1/agent — auth', () => {
  beforeEach(resetAllMocks)

  test('rejects with the auth gate response when unauthenticated/invalid token', async () => {
    authGateResponse = new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })

    const res = await postAgent()

    expect(res.status).toBe(401)
    expect(authorizeAgentApiRequest).toHaveBeenCalledTimes(1)
    // Auth is checked before any billing/agent work runs.
    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('rejects when the per-IP rate limit is exceeded, before auth even runs', async () => {
    ipRateLimitAllowed = false
    ipRetryAfterSec = 42

    const res = await postAgent()

    expect(res.status).toBe(429)
    expect(authorizeAgentApiRequest).not.toHaveBeenCalled()
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('accepts a valid request through the auth/rate-limit gates', async () => {
    const res = await postAgent()

    // createAgentImpl (default) throws pre-stream, so the *response* is still
    // an error — that's expected and irrelevant here. What this test proves is
    // that a valid request is let THROUGH auth/rate-limiting to the billing +
    // agent-creation stage, instead of being rejected at the gate.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(authorizeAgentApiRequest).toHaveBeenCalledTimes(1)
    expect(createClickHouseAgent).toHaveBeenCalledTimes(1)
  })
})

// --- 2. MONEY --------------------------------------------------------------------

describe('POST /api/v1/agent — quota + billing enforcement (money)', () => {
  beforeEach(resetAllMocks)

  test('Free-tier over daily cap: reserves, rejects with 402, and releases the reservation', async () => {
    dailyCheckAllowed = false
    reserveResult = 6 // post-increment count, over the (mocked) cap

    const res = await postAgent()

    expect(res.status).toBe(402)
    const body = (await res.json()) as { details: { reason: string } }
    expect(body.details.reason).toBe('ai_daily_limit')

    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledWith(OWNER_ID)
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledWith(OWNER_ID)
    // Rejected before ever reaching agent construction.
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('monthly USD budget exceeded: rejects with 402 without ever reserving a daily slot', async () => {
    planAiMonthlyUsdBudget = 5
    budgetCheckAllowed = false

    const res = await postAgent()

    expect(res.status).toBe(402)
    const body = (await res.json()) as { details: { reason: string } }
    expect(body.details.reason).toBe('ai_budget_limit')

    expect(getAiSpendThisMonth).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(releaseAiUsage).not.toHaveBeenCalled()
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('BYOK requests skip daily/monthly gating entirely and record a BYOK activation', async () => {
    const res = await postAgent({
      message: 'hello',
      model: 'test/test-model',
      apiKey: 'sk-test-byok-1234567890',
    })

    // createAgentImpl still throws (default) — irrelevant to what's being
    // proven here: BYOK must never touch the included-credit meters.
    expect(res.status).toBeGreaterThanOrEqual(400)

    expect(recordByokActivation).toHaveBeenCalledTimes(1)
    expect(recordByokActivation).toHaveBeenCalledWith(OWNER_ID)
    expect(getPlanForOwner).not.toHaveBeenCalled()
    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(getAiSpendThisMonth).not.toHaveBeenCalled()
    // releaseReservationOnce() still runs on the pre-stream throw, but is a
    // no-op because billingOwnerId stays null on the BYOK path.
    expect(releaseAiUsage).not.toHaveBeenCalled()

    // The BYOK key is forwarded into the agent factory.
    const lastCall = createClickHouseAgent.mock.calls.at(-1)?.[0] as
      | { apiKey?: string }
      | undefined
    expect(lastCall?.apiKey).toBe('sk-test-byok-1234567890')
  })

  test('createClickHouseAgent throw closes connected custom MCP servers AND releases the daily reservation (#2675)', async () => {
    // Unlike agent-quota-release.test.ts (mergeMcpServers always returns []),
    // this configures an actually-connected custom MCP server so the pre-stream
    // failure path's `mcpCloseAll()` call is exercised too, not just the
    // reservation release.
    mergedServersResult = [
      { id: 's1', name: 'srv', endpoint: 'http://127.0.0.1:1' },
    ]

    const res = await postAgent()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(connectCustomMcpServers).toHaveBeenCalledTimes(1)
    expect(mcpCloseAll).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledWith(OWNER_ID)
  })

  test('a mid-stream agent failure releases the daily reservation', async () => {
    const streamMock = mock(async () => {
      throw new Error('mid-stream boom')
    })
    createAgentImpl = () => ({ stream: streamMock })

    const res = await postAgent()

    // The streaming Response itself is 200 — the failure surfaces as a
    // `data-error` part inside the SSE body, not as an HTTP error status.
    expect(res.status).toBe(200)
    await drain(res)

    expect(streamMock).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledTimes(1)
    expect(releaseAiUsage).toHaveBeenCalledWith(OWNER_ID)
  })
})

// --- 3. INPUT VALIDATION -----------------------------------------------------

describe('POST /api/v1/agent — input validation / malformed body', () => {
  beforeEach(resetAllMocks)

  test('invalid JSON payload -> 400 INVALID_JSON', async () => {
    const res = await postAgentRaw('{not json')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_JSON')
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('missing/empty message -> 400', async () => {
    const res = await postAgent({ model: 'test/test-model' })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Message is required')
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('too many messages -> 400 with maxMessages detail', async () => {
    const messages = Array.from({ length: 65 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      parts: [{ type: 'text', text: `msg ${i}` }],
    }))

    const res = await postAgent({ messages, model: 'test/test-model' })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { maxMessages: number } }
    expect(body.error.maxMessages).toBe(64)
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('oversized payload rejected via content-length header -> 413', async () => {
    const res = await getHandler()({
      request: new Request('http://localhost/api/v1/agent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(200 * 1024),
        },
        body: JSON.stringify({ message: 'hello' }),
      }),
    })

    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { limitBytes: number } }
    expect(body.error.limitBytes).toBe(128 * 1024)
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })
})

// --- 4. ERROR PATHS / STATUS CODES --------------------------------------------

describe('POST /api/v1/agent — error paths / status codes', () => {
  beforeEach(resetAllMocks)

  test('provider not configured on this deployment -> 503', async () => {
    providerConfigured = false

    const res = await postAgent()

    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('provider_not_configured')
    expect(createClickHouseAgent).not.toHaveBeenCalled()
    expect(reserveAiUsage).not.toHaveBeenCalled()
  })

  test('a pre-stream createClickHouseAgent throw is converted into a structured 500 JSON error by the outer boundary', async () => {
    const res = await postAgent()

    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as {
      error: { message: string; type: string }
    }
    expect(body.error.message).toContain('boom: agent construction failed')
    // No 4xx/5xx code embedded in the message and no recognizable keyword
    // (auth/billing/rate-limit/timeout/...) — classifyError's fallback bucket.
    expect(body.error.type).toBe('unknown')
  })
})
