/**
 * AI Agent API Endpoint (Streaming)
 *
 * POST /api/v1/agent
 *
 * Processes natural language queries through the AI SDK ToolLoopAgent
 * and streams results back using the Vercel AI SDK's UI Message Stream format.
 * This enables the frontend `useChat` hook to consume events in real-time,
 * including tool call rendering.
 *
 * The handler is a thin orchestration of four phases, each in its own module
 * under `./-agent/` (the `-` prefix keeps them out of the router's route tree):
 * parse (`request-parsing.ts`) → gate (`billing.ts`) → build runtime
 * (`runtime.ts`) → stream (`stream.ts`), with every error → HTTP mapping in
 * `errors.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'

import { applyAiUsageGate } from './-agent/billing'
import { AGENT_DEBUG_LOGS } from './-agent/debug'
import {
  parseFailureResponse,
  providerNotConfiguredResponse,
  unhandledErrorResponse,
} from './-agent/errors'
import {
  hardenGuestAgentRequest,
  parseAgentRequest,
} from './-agent/request-parsing'
import {
  buildUiMessages,
  createAgentRuntime,
  resolveAgentModel,
  resolveAgentUserId,
} from './-agent/runtime'
import { createAgentStreamResponse } from './-agent/stream'
import { env } from 'cloudflare:workers'
import { isProviderConfigured, parseModelId } from '@/lib/ai/providers'
import {
  checkRateLimitDurable,
  clientIpKey,
  getAgentRateLimitPerMin,
  RATE_LIMIT_BINDING_AGENT,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'
import {
  getGuestAiRateLimitPerMin,
  guestOwnerIdFromIp,
} from '@/lib/billing/guest-ai'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { ACTIONS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

export type { SafePageContext } from './-agent/request-parsing'

// Re-exported for the pure-helper unit tests (`agent-page-context.test.ts`)
// and any caller that already imports them from this route module.
export {
  buildPageContextLine,
  sanitizePageContext,
} from './-agent/request-parsing'

/**
 * Handle POST requests for agent processing with streaming
 */
async function handlePost(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  // Rate-limit by IP first, then tighten per identity after auth resolves.
  const ip = clientIpKey(request)
  const rlResult = await checkRateLimitDurable(
    `agent:ip:${ip}`,
    getAgentRateLimitPerMin(),
    RATE_LIMIT_BINDING_AGENT
  )
  if (!rlResult.allowed) return rateLimitResponse(rlResult.retryAfterSec)

  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  const parsedRaw = await parseAgentRequest(request)
  if (!parsedRaw.ok) return parseFailureResponse(parsedRaw)

  const clerkUserId = await resolveAgentUserId()
  const isGuest = clerkUserId === 'guest'
  const guestOwnerId =
    isGuest && isCloudModeServer() ? await guestOwnerIdFromIp(ip) : undefined
  const parsed =
    guestOwnerId !== undefined
      ? hardenGuestAgentRequest(parsedRaw)
      : parsedRaw

  const model = await resolveAgentModel(parsed.body.model)
  const byok = parsed.byokApiKey !== null

  // Preflight: refuse early if the selected provider has no API key on this
  // deployment. Skipped for BYOK — the user brings the credential.
  const { provider: requestedProvider } = parseModelId(model)
  if (!byok && !isProviderConfigured(requestedProvider)) {
    return providerNotConfiguredResponse(model, requestedProvider)
  }

  // Cloud guests get a stable per-IP `guest:<hash>` so usage explorer can
  // group by visitor, not a single shared `guest` string. OSS guests stay
  // the literal `guest`. Identity is resolved before hardening so BYOK/MCP
  // never reach the runtime for Cloud guests.
  const userId = guestOwnerId ?? clerkUserId
  const openRouterUser = `${userId}/${parsed.sessionId}`

  // Tighten the coarse per-IP budget (checked at request entry) to a
  // per-identity budget now that auth has resolved. Signed-in accounts cannot
  // fan out across IPs. Cloud guests get a tighter dedicated bucket in
  // addition to the IP bucket above. OSS guests keep IP-only.
  if (guestOwnerId) {
    const identityRl = await checkRateLimitDurable(
      `agent:guest:${guestOwnerId}`,
      getGuestAiRateLimitPerMin(),
      RATE_LIMIT_BINDING_AGENT
    )
    if (!identityRl.allowed) return rateLimitResponse(identityRl.retryAfterSec)
  } else if (!isGuest) {
    const identityRl = await checkRateLimitDurable(
      `agent:user:${userId}`,
      getAgentRateLimitPerMin(),
      RATE_LIMIT_BINDING_AGENT
    )
    if (!identityRl.allowed) return rateLimitResponse(identityRl.retryAfterSec)
  }

  if (AGENT_DEBUG_LOGS) {
    console.log('[Agent API] OpenRouter user:', openRouterUser)
  }

  const controlToolsEnabled = process.env.AGENT_ENABLE_CONTROL_TOOLS === 'true'
  const actionsPermissionResponse = controlToolsEnabled
    ? await authorizeFeatureRequest(ACTIONS_FEATURE_PERMISSION, request, {
        allowAgentBearerToken: true,
      })
    : null
  const includeControlTools = controlToolsEnabled && !actionsPermissionResponse

  const gate = await applyAiUsageGate(byok, { ip, guestOwnerId })
  if (!gate.ok) return gate.response

  const { agent, mcpCloseAll } = await createAgentRuntime({
    userId,
    requestMcpServers: parsed.mcpServers,
    hostId: parsed.hostId,
    model,
    disabledTools: parsed.disabledTools,
    openRouterUser,
    requestOrigin: request.headers.get('origin') ?? undefined,
    includeControlTools,
    sessionId: parsed.sessionId,
    byokApiKey: parsed.byokApiKey,
    releaseReservationOnce: gate.releaseReservationOnce,
  })

  const uiMessages = buildUiMessages({
    safeIncomingMessages: parsed.safeIncomingMessages,
    userMessage: parsed.userMessage,
    pageContext: parsed.pageContext,
    hostId: parsed.hostId,
  })

  if (AGENT_DEBUG_LOGS) {
    console.log('[Agent API] uiMessages count:', uiMessages.length)
    console.log('[Agent API] Model being used:', model)
  }

  return createAgentStreamResponse({
    agent,
    mcpCloseAll,
    uiMessages,
    userMessage: parsed.userMessage,
    model,
    requestedProvider,
    billingOwnerId: gate.billingOwnerId,
    resolvedPlan: gate.resolvedPlan,
    releaseReservationOnce: gate.releaseReservationOnce,
    byokApiKey: parsed.byokApiKey,
  })
}

/**
 * Outermost error boundary for the agent endpoint.
 *
 * `handlePost` guards every individual step (auth, MCP connect, billing, the
 * stream body) but the pre-stream setup — `createAgentRuntime`,
 * `authorizeAgentApiRequest` — runs before the streaming Response is built. If
 * any of those throws (e.g. a provider/runtime edge case), the rejection would
 * otherwise escape to the framework, which serves a bare `text/html` 500. The
 * client's `apiFetch` then surfaces that as the opaque "Request failed (500
 * Error)". Wrapping the handler converts any uncaught throw into a structured,
 * classified `application/json` error the chat UI can render.
 */
async function handlePostWithBoundary(request: Request): Promise<Response> {
  try {
    return await handlePost(request)
  } catch (error) {
    return unhandledErrorResponse(error)
  }
}

export const Route = createFileRoute('/api/v1/agent')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePostWithBoundary(request),
    },
  },
})
