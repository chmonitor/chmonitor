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
 * Ported from apps/dashboard/app/api/v1/agent/route.ts.
 * - next/server NextResponse not used here (handler builds Web Response /
 *   createUIMessageStreamResponse directly).
 * - `export const dynamic = 'force-dynamic'` dropped (no Next static export).
 * - Clerk: '@clerk/nextjs/server' auth() -> '@clerk/tanstack-react-start/server'
 *   auth(). NOTE: @clerk/tanstack-react-start@1.3.2 exports `auth` with a
 *   no-request signature (GetAuthFnNoRequest), NOT `getAuth(request)`; the task
 *   said getAuth(request) but that symbol does not exist in this SDK version.
 *   Behavior is identical: best-effort userId for OpenRouter tracking, gated by
 *   isClerkAuthProvider(), wrapped in try/catch so anonymous requests still work.
 * - bridgeClickHouseEnv(env) is invoked before agent creation so tools that hit
 *   ClickHouse see CLICKHOUSE_* on process.env.
 * - The AI SDK createUIMessageStreamResponse() returns a Web Response — returned
 *   directly from the TanStack Start server handler.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { LanguageModelUsage } from 'ai'

import { env } from 'cloudflare:workers'
import { pipeJsonRender } from '@json-render/core'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIDataTypes,
  type UIMessage,
  type UITools,
} from 'ai'
import { createClickHouseAgent } from '@/lib/ai/agent'
import { aggregateUsageWithCost } from '@/lib/ai/agent/analytics'
import { classifyError } from '@/lib/ai/agent/errors'
import { AGENT_JSON_RENDER_INLINE_PROMPT } from '@/lib/ai/agent/json-render-inline-prompt'
import { createJsonRenderPatchGuardStream } from '@/lib/ai/agent/json-render-patch-guard'
import {
  type CustomMcpServerInput,
  connectCustomMcpServers,
} from '@/lib/ai/agent/mcp/connect-custom-servers'
import { resolveDefaultAgentModel } from '@/lib/ai/agent-model-registry'
import {
  getProviderName,
  isProviderConfigured,
  parseModelId,
} from '@/lib/ai/providers'
import {
  checkRateLimit,
  clientIpKey,
  getAgentRateLimitPerMin,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'
import { isClerkAuthProvider } from '@/lib/auth/provider'
import {
  addAiSpend,
  getAiSpendThisMonth,
  releaseAiUsage,
  reserveAiUsage,
} from '@/lib/billing/ai-usage-store'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkAiBudget,
  checkAiDailyLimit,
  limitMessage,
} from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { ACTIONS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

// Verbose agent request/usage logging. Opt-in via an explicit AGENT_DEBUG flag
// rather than `NODE_ENV !== 'production'`: a self-hosted deploy that runs with
// NODE_ENV unset would otherwise log request internals (message keys, resolved
// user ids, usage) by default. Fails closed — off unless AGENT_DEBUG is truthy.
const AGENT_DEBUG_LOGS = (() => {
  const raw = process.env.AGENT_DEBUG?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
})()

const AGENT_MAX_REQUEST_SIZE_BYTES = 128 * 1024
// Free / routed providers can take 20-40s between a tool call and the
// follow-up summary. The previous 12s step/chunk budget killed the loop
// after the first tool call on slower models. Give it real room and let
// stepCountIs(maxSteps) remain the actual termination guard.
const AGENT_STREAM_TIMEOUT_MS = 120_000
const AGENT_STREAM_STEP_TIMEOUT_MS = 45_000
const AGENT_MAX_MESSAGES = 64
const AGENT_MAX_MESSAGE_PARTS = 64
const AGENT_MAX_USER_MESSAGE_LENGTH = 8_192
const AGENT_MAX_PART_TEXT_LENGTH = 2_048
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type AgentRequestBody = {
  message?: string
  messages?: Array<
    | { id: string; role: string; parts: Array<unknown> }
    | { role: string; content: string; parts?: unknown[] }
  >
  hostId?: number
  model?: string
  disabledTools?: string[]
  sessionId?: string
  mcpServers?: Array<{ id?: unknown; name?: unknown; endpoint?: unknown }>
}

type SanitizeIncomingMessagesResult =
  | {
      readonly ok: true
      readonly messages: ReadonlyArray<SafeAgentMessage>
    }
  | {
      readonly ok: false
      readonly reason: 'too_many_messages'
    }

type SafeAgentMessage = {
  readonly id: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly parts: Array<{
    [key: string]: unknown
    type: string
  }>
  readonly content?: string
}

/**
 * Check whether a value is an object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Truncate text to a safe UTF-8 byte length.
 */
function clampText(value: string, maxBytes: number): string {
  const encoded = textEncoder.encode(value)
  if (encoded.length <= maxBytes) {
    return value
  }

  let end = maxBytes
  while (
    end > 0 &&
    end < encoded.length &&
    (encoded[end] & 0b1100_0000) === 0b1000_0000
  ) {
    end -= 1
  }

  return textDecoder.decode(encoded.slice(0, end))
}

async function readRequestBodyTextWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ text: string; byteLength: number } | null> {
  const bodyStream = request.body
  if (!bodyStream) {
    return { text: '', byteLength: 0 }
  }

  const reader = bodyStream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      byteLength += value.length
      if (byteLength > maxBytes) {
        try {
          await reader.cancel()
        } catch (_error) {
          // Ignore cancellation errors if the stream is already closed.
        }
        return null
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }

  chunks.push(decoder.decode())
  return { text: chunks.join(''), byteLength }
}

/**
 * Sanitize one message part.
 */
function sanitizeMessagePart(part: unknown): {
  [key: string]: unknown
  type: string
} | null {
  if (!isObject(part) || typeof part.type !== 'string') {
    return null
  }

  const safePart: { [key: string]: unknown; type: string } = {
    ...part,
    type: part.type,
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    safePart.text = clampText(part.text, AGENT_MAX_PART_TEXT_LENGTH)
  }

  return safePart
}

/**
 * Map model roles into the accepted role set.
 */
function normalizeRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

/**
 * Sanitize raw user messages into the safe internal message shape.
 *
 * - Cap total messages at `AGENT_MAX_MESSAGES`.
 * - Cap per-message parts at `AGENT_MAX_MESSAGE_PARTS`.
 * - Clamp text fields to configured byte limits.
 * - Drops malformed/empty messages.
 */
function sanitizeIncomingMessages(
  messages: unknown[] | undefined
): SanitizeIncomingMessagesResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: true, messages: [] }
  }

  if (messages.length > AGENT_MAX_MESSAGES) {
    return { ok: false, reason: 'too_many_messages' }
  }

  const sanitizedMessages = messages
    .map((msg): SafeAgentMessage | null => {
      if (!isObject(msg) || typeof msg.role !== 'string') {
        return null
      }

      const role = normalizeRole(msg.role)
      const parts = Array.isArray(msg.parts)
        ? msg.parts
            .slice(0, AGENT_MAX_MESSAGE_PARTS)
            .map(sanitizeMessagePart)
            .filter(
              (part): part is { type: string; [key: string]: unknown } =>
                part !== null
            )
        : []

      const contentRaw = msg.content
      const content =
        typeof contentRaw === 'string'
          ? clampText(contentRaw, AGENT_MAX_USER_MESSAGE_LENGTH)
          : null

      if (parts.length === 0 && !content) {
        return null
      }

      return {
        id: typeof msg.id === 'string' ? msg.id : crypto.randomUUID(),
        role,
        parts,
        content: content ?? undefined,
      }
    })
    .filter((value): value is SafeAgentMessage => value !== null)

  return { ok: true, messages: sanitizedMessages }
}

/**
 * Handle POST requests for agent processing with streaming
 */
async function handlePost(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  // Rate-limit by IP first, then tighten per identity after auth resolves.
  const ip = clientIpKey(request)
  const rlResult = checkRateLimit(`agent:ip:${ip}`, getAgentRateLimitPerMin())
  if (!rlResult.allowed) return rateLimitResponse(rlResult.retryAfterSec)

  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const declaredSize = Number(contentLengthHeader)
    if (
      !Number.isNaN(declaredSize) &&
      declaredSize > AGENT_MAX_REQUEST_SIZE_BYTES
    ) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Request payload too large',
            limitBytes: AGENT_MAX_REQUEST_SIZE_BYTES,
          },
        }),
        { status: 413, headers: { 'content-type': 'application/json' } }
      )
    }
  }

  const requestBodyResult = await readRequestBodyTextWithLimit(
    request,
    AGENT_MAX_REQUEST_SIZE_BYTES
  )
  if (requestBodyResult === null) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Request payload too large',
          limitBytes: AGENT_MAX_REQUEST_SIZE_BYTES,
        },
      }),
      { status: 413, headers: { 'content-type': 'application/json' } }
    )
  }

  let body: AgentRequestBody
  try {
    const parsedBody = JSON.parse(requestBodyResult.text)
    if (
      !isObject(parsedBody) ||
      Array.isArray(parsedBody) ||
      parsedBody === null
    ) {
      throw new Error('INVALID_PAYLOAD')
    }

    body = parsedBody
  } catch (_error) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Invalid JSON payload',
          code: 'INVALID_JSON',
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  if (AGENT_DEBUG_LOGS) {
    console.log('[Agent API] Request body keys:', Object.keys(body))
    console.log('[Agent API] Messages count:', body.messages?.length)
  }

  const safeIncomingMessagesResult = sanitizeIncomingMessages(body.messages)

  if (!safeIncomingMessagesResult.ok) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Too many messages. Maximum is ${AGENT_MAX_MESSAGES}.`,
          maxMessages: AGENT_MAX_MESSAGES,
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const safeIncomingMessages = safeIncomingMessagesResult.messages

  if (
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    safeIncomingMessages.length === 0 &&
    typeof body.message !== 'string'
  ) {
    return new Response(
      JSON.stringify({
        error: { message: 'No valid messages were provided.' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const lastUserMessage = safeIncomingMessages
    .filter((m) => m.role === 'user')
    ?.pop()

  const textPart = lastUserMessage?.parts?.find(
    (p): p is { type: 'text'; text: string } =>
      typeof p === 'object' &&
      p !== null &&
      'type' in p &&
      p.type === 'text' &&
      'text' in p &&
      typeof p.text === 'string' &&
      p.text.trim().length > 0
  )

  const userMessage =
    (typeof body.message === 'string'
      ? clampText(body.message, AGENT_MAX_USER_MESSAGE_LENGTH)
      : undefined) ||
    textPart?.text ||
    lastUserMessage?.content

  const hasNonTextParts =
    Array.isArray(lastUserMessage?.parts) &&
    lastUserMessage.parts.length > 0 &&
    !textPart

  if (
    !hasNonTextParts &&
    (typeof userMessage !== 'string' || !userMessage.trim())
  ) {
    return new Response(
      JSON.stringify({
        error: { message: 'Message is required and must be a string' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const rawHostId =
    typeof body.hostId === 'string' ? Number(body.hostId) : body.hostId
  const hostId =
    typeof rawHostId === 'number' && Number.isFinite(rawHostId)
      ? Math.max(0, Math.trunc(rawHostId))
      : 0
  const configuredModel = process.env.LLM_MODEL?.trim()
  const model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : configuredModel || resolveDefaultAgentModel()

  // Preflight: refuse early if the selected provider has no API key on this
  // deployment. Without this, the upstream provider returns a confusing
  // "Missing Authorization header" error that looks like *our* auth failed.
  const { provider: requestedProvider } = parseModelId(model)
  if (!isProviderConfigured(requestedProvider)) {
    const classified = classifyError(
      {
        statusCode: 503,
        error: {
          code: 'provider_not_configured',
          message: `Provider "${getProviderName(requestedProvider)}" is not configured on this deployment. Pick a model from a configured provider or ask the operator to set ${requestedProvider.toUpperCase()}_API_KEY.`,
        },
      },
      { model, provider: requestedProvider }
    )

    return new Response(
      JSON.stringify({
        error: classified,
      }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    )
  }

  const disabledTools = Array.isArray(body.disabledTools)
    ? body.disabledTools.filter((t) => typeof t === 'string')
    : []
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.length > 0
      ? body.sessionId
      : crypto.randomUUID()

  // Resolve user ID for OpenRouter user tracking
  let userId = 'guest'
  if (isClerkAuthProvider()) {
    try {
      const { auth } = await import('@clerk/tanstack-react-start/server')
      const authResult = await auth()
      if (authResult?.userId) userId = authResult.userId
    } catch {
      // Clerk session unavailable
    }
  }
  const openRouterUser = `${userId}/${sessionId}`

  // Tighten the coarse per-IP budget (checked at request entry) to a per-identity
  // budget now that auth has resolved, so one signed-in account cannot fan out
  // across many IPs to exceed its allowance. Anonymous callers keep the per-IP
  // bucket above as their identity, so this only adds a stricter per-user gate.
  if (userId !== 'guest') {
    const identityRl = checkRateLimit(
      `agent:user:${userId}`,
      getAgentRateLimitPerMin()
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

  // Parse and validate custom MCP servers from the request body.
  const rawMcpServers = Array.isArray(body.mcpServers)
    ? body.mcpServers.slice(0, 5)
    : []
  const validMcpServers: CustomMcpServerInput[] = rawMcpServers
    .filter(
      (s): s is { id: string; name: string; endpoint: string } =>
        isObject(s) &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.endpoint === 'string'
    )
    .map((s) => ({ id: s.id, name: s.name, endpoint: s.endpoint }))

  // Connect custom MCP servers (if any) before creating the agent.
  // closeAll() is called in onEnd so connections are freed after streaming.
  let mcpCloseAll: (() => Promise<void>) | null = null
  let extraTools: Record<string, unknown> | undefined

  if (validMcpServers.length > 0) {
    const mcpResult = await connectCustomMcpServers(validMcpServers)
    mcpCloseAll = mcpResult.closeAll
    extraTools =
      Object.keys(mcpResult.tools).length > 0 ? mcpResult.tools : undefined

    const connected = mcpResult.statuses.filter(
      (s) => s.status === 'connected'
    ).length
    const errored = mcpResult.statuses.filter(
      (s) => s.status === 'error'
    ).length
    console.log(
      `[Agent API] Custom MCP servers: ${connected} connected, ${errored} failed`
    )
  }

  // AI usage enforcement (cloud only): daily message meter + monthly USD budget.
  // resolveBillingOwner() throws when Clerk is not configured (self-hosted),
  // so the entire block is wrapped in try/catch — OSS deployments skip silently.
  //
  // billingOwnerId / reservedDailyUsage are hoisted so the stream can (a) charge
  // the monthly spend accumulator with the actual estimatedCostUsd once the
  // generation succeeds, and (b) roll back the daily reservation if generation
  // fails before it produces any output.
  let billingOwnerId: string | null = null
  let reservedDailyUsage = false
  try {
    const owner = await resolveBillingOwner()
    const plan = await getPlanForOwner(owner.id)
    billingOwnerId = owner.id

    // Monthly LLM spend budget — hard cap (null = Enterprise BYOK / unlimited).
    if (plan.aiMonthlyUsdBudget != null) {
      const spentUsd = await getAiSpendThisMonth(owner.id)
      const budget = checkAiBudget(plan, spentUsd)
      if (!budget.allowed) {
        return new Response(
          JSON.stringify({
            error: limitMessage(budget),
            details: {
              planId: budget.planId,
              limit: budget.limit ?? plan.aiMonthlyUsdBudget,
              reason: budget.reason,
            },
          }),
          { status: 402, headers: { 'content-type': 'application/json' } }
        )
      }
    }

    // Daily message meter — reserve one slot atomically, then decide. The
    // reservation (post-increment count) is rolled back below if it exceeds the
    // hard cap, and again in the stream if generation fails before starting.
    if (plan.aiRequestsPerDay != null) {
      const reservedCount = await reserveAiUsage(owner.id)
      if (reservedCount != null) {
        reservedDailyUsage = true
        // reservedCount is the count *after* this reservation; usage before this
        // request is reservedCount - 1.
        const check = checkAiDailyLimit(plan, reservedCount - 1)
        if (!check.allowed) {
          await releaseAiUsage(owner.id)
          reservedDailyUsage = false
          return new Response(
            JSON.stringify({
              error: limitMessage(check),
              details: {
                planId: check.planId,
                limit: check.limit ?? plan.aiRequestsPerDay,
                reason: check.reason,
              },
            }),
            { status: 402, headers: { 'content-type': 'application/json' } }
          )
        }
      }
    }
  } catch {
    // Not cloud / no Clerk owner → skip enforcement; self-hosted stays whole.
    billingOwnerId = null
    reservedDailyUsage = false
  }

  const requestOrigin = request.headers.get('origin') ?? undefined
  const agent = createClickHouseAgent({
    hostId,
    model,
    disabledTools,
    systemPrompt: AGENT_JSON_RENDER_INLINE_PROMPT,
    providerOptions: { openrouter: { user: openRouterUser } },
    referer: requestOrigin,
    includeControlTools,
    sessionId,
    extraTools,
  })

  const uiMessages: Array<{
    id: string
    role: 'user' | 'system' | 'assistant'
    parts: Array<unknown>
  }> = []

  if (safeIncomingMessages.length > 0) {
    for (const msg of safeIncomingMessages) {
      if (msg.role === 'user') {
        if (msg.parts.length > 0) {
          uiMessages.push({
            id: msg.id,
            role: 'user',
            parts: msg.parts,
          })
        } else if (msg.content) {
          uiMessages.push({
            id: msg.id,
            role: 'user',
            parts: [{ type: 'text' as const, text: msg.content }],
          })
        }

        continue
      }

      if (msg.parts.length > 0) {
        uiMessages.push({
          id: msg.id,
          role: msg.role,
          parts: msg.parts,
        })
      } else if (msg.content) {
        uiMessages.push({
          id: msg.id,
          role: msg.role,
          parts: [{ type: 'text' as const, text: msg.content }],
        })
      }
    }
  }

  if (uiMessages.length === 0 && userMessage) {
    uiMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text' as const, text: userMessage }],
    })
  }

  if (AGENT_DEBUG_LOGS) {
    console.log('[Agent API] uiMessages count:', uiMessages.length)
    console.log('[Agent API] Model being used:', model)
  }

  const usageSteps: LanguageModelUsage[] = []
  // Tracks the provider-reported model ID from the last completed step.
  // Populated synchronously in onStepEnd so it is available after consumeStream().
  let lastStepModelId: string | undefined

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let modelMessages: ModelMessage[] = []

      try {
        modelMessages = await convertToModelMessages(
          uiMessages as Array<
            Omit<UIMessage<unknown, UIDataTypes, UITools>, 'id'>
          >,
          {
            ignoreIncompleteToolCalls: true,
          }
        )
      } catch (_error) {
        modelMessages = [
          {
            role: 'user',
            content:
              typeof userMessage === 'string'
                ? userMessage
                : 'Request context unavailable.',
          },
        ] as ModelMessage[]
      }

      try {
        const result = await agent.stream({
          messages: modelMessages,
          onStepEnd: (step) => {
            usageSteps.push(step.usage)
            // Capture the provider-reported model ID (e.g., the resolved model
            // behind an auto-router preset). Falls back gracefully if absent.
            if (step.response?.modelId) {
              lastStepModelId = step.response.modelId
            }

            const { inputTokenDetails } = step.usage
            if (
              inputTokenDetails &&
              (inputTokenDetails.cacheReadTokens ||
                inputTokenDetails.cacheWriteTokens)
            ) {
              if (AGENT_DEBUG_LOGS) {
                console.log('[Agent API] Cache token stats:', {
                  cacheReadTokens: inputTokenDetails.cacheReadTokens,
                  cacheWriteTokens: inputTokenDetails.cacheWriteTokens,
                  inputTokens: step.usage.inputTokens,
                  outputTokens: step.usage.outputTokens,
                })
              }
            }
          },
          timeout: {
            totalMs: AGENT_STREAM_TIMEOUT_MS,
            stepMs: AGENT_STREAM_STEP_TIMEOUT_MS,
            chunkMs: AGENT_STREAM_STEP_TIMEOUT_MS,
          },
        })

        writer.merge(
          createJsonRenderPatchGuardStream(
            pipeJsonRender(result.toUIMessageStream())
          )
        )
        await result.consumeStream()

        // After stream consumption, attempt to get the final response modelId.
        // result.response is a PromiseLike that resolves once the stream is done.
        let resolvedModel: string | undefined = lastStepModelId
        if (!resolvedModel) {
          try {
            const responseMetadata = await result.response
            if (responseMetadata.modelId) {
              resolvedModel = responseMetadata.modelId
            }
          } catch {
            // response metadata unavailable — fall back to requested model
          }
        }
        resolvedModel = resolvedModel || model

        // Send aggregated usage/cost as a data part so the client can display it
        if (usageSteps.length > 0) {
          const stats = {
            ...aggregateUsageWithCost(usageSteps, model),
            model,
            provider: requestedProvider,
            resolvedModel,
          }
          writer.write({
            type: 'data-usage',
            data: [stats],
          })

          // Charge the monthly USD budget with the actual spend now that the
          // generation succeeded (cloud only; no-op when D1/owner absent).
          if (billingOwnerId && stats.estimatedCostUsd) {
            await addAiSpend(billingOwnerId, stats.estimatedCostUsd)
          }
        }
      } catch (error) {
        const classified = classifyError(error, {
          model,
          provider: requestedProvider,
        })
        console.error('[Agent API] Classified error:', classified)
        writer.write({
          type: 'data-error',
          data: [classified],
        })
        if (usageSteps.length > 0) {
          const stats = {
            ...aggregateUsageWithCost(usageSteps, model),
            model,
            provider: requestedProvider,
            resolvedModel: lastStepModelId || model,
          }
          writer.write({
            type: 'data-usage',
            data: [stats],
          })
          // Generation started and incurred cost before failing — still charge
          // the monthly budget for what was actually spent.
          if (billingOwnerId && stats.estimatedCostUsd) {
            await addAiSpend(billingOwnerId, stats.estimatedCostUsd)
          }
        } else if (billingOwnerId && reservedDailyUsage) {
          // Generation failed before producing any output — release the daily
          // reservation so aborted requests don't consume the user's quota.
          await releaseAiUsage(billingOwnerId)
        }
      }
    },
    onError: (error) => {
      const classified = classifyError(error, {
        model,
        provider: requestedProvider,
      })
      console.error('[Agent API] Classified error:', classified)
      return JSON.stringify(classified)
    },
    onEnd: () => {
      // Close any connected custom MCP servers now that the stream is done.
      if (mcpCloseAll) {
        mcpCloseAll().catch((e) => {
          console.error('[Agent API] MCP closeAll error:', e)
        })
      }

      if (AGENT_DEBUG_LOGS && usageSteps.length > 0) {
        const stats = {
          ...aggregateUsageWithCost(usageSteps, model),
          model,
          provider: requestedProvider,
          resolvedModel: lastStepModelId || model,
        }
        console.log('[Agent API] Session usage:', stats)
      }
    },
    originalMessages: uiMessages as unknown as UIMessage[],
  })

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Outermost error boundary for the agent endpoint.
 *
 * `handlePost` guards every individual step (auth, MCP connect, billing, the
 * stream body) but the pre-stream setup — `createClickHouseAgent`,
 * `connectCustomMcpServers`, `authorizeAgentApiRequest` — runs before the
 * streaming Response is built. If any of those throws (e.g. a provider/runtime
 * edge case), the rejection would otherwise escape to the framework, which
 * serves a bare `text/html` 500. The client's `apiFetch` then surfaces that as
 * the opaque "Request failed (500 Error)". Wrapping the handler converts any
 * uncaught throw into a structured, classified `application/json` error the chat
 * UI can render (title, cause, suggestion) and logs the raw cause so the true
 * origin is visible in worker logs / Sentry.
 */
async function handlePostWithBoundary(request: Request): Promise<Response> {
  try {
    return await handlePost(request)
  } catch (error) {
    const classified = classifyError(error)
    console.error('[Agent API] Unhandled error:', classified, error)
    const status =
      typeof classified.statusCode === 'number' && classified.statusCode >= 400
        ? classified.statusCode
        : 500
    return new Response(JSON.stringify({ error: classified }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

export const Route = createFileRoute('/api/v1/agent')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePostWithBoundary(request),
    },
  },
})
