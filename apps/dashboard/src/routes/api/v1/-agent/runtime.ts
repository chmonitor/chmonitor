/**
 * Runtime assembly for POST /api/v1/agent: model resolution, caller identity,
 * the UI-message list handed to the AI SDK, and agent + custom-MCP creation.
 *
 * Extracted from `handlePost` in issue #2885 — no behavioural change.
 */

import type { SafeAgentMessage, SafePageContext } from './request-parsing'

import { buildPageContextLine } from './request-parsing'
import { createClickHouseAgent } from '@/lib/ai/agent'
import { AGENT_JSON_RENDER_INLINE_PROMPT } from '@/lib/ai/agent/json-render-inline-prompt'
import {
  type CustomMcpServerInput,
  connectCustomMcpServers,
  loadUserRegisteredServers,
  mergeMcpServers,
} from '@/lib/ai/agent/mcp/connect-custom-servers'
import {
  DEFAULT_AGENT_MODEL,
  resolveDefaultAgentModel,
} from '@/lib/ai/agent-model-registry'
import {
  isAnyRouterAutoModelId,
  resolveAnyRouterAutoModelId,
} from '@/lib/ai/anyrouter-dynamic-models'
import { isProviderConfigured } from '@/lib/ai/providers'
import { isClerkAuthProvider } from '@/lib/auth/provider'
import { isGuestOwnerId } from '@/lib/billing/guest-ai'

export type AgentUiMessage = {
  id: string
  role: 'user' | 'system' | 'assistant'
  parts: Array<unknown>
}

/**
 * Resolve the model id for this request: explicit body model, else the
 * deployment's `LLM_MODEL`, else the registry default.
 *
 * `anyrouter:auto` is a picker alias — resolve to the current top-by-usage
 * tool-capable model (cached) before provider preflight / chat setup.
 * Fail-soft: curated DEFAULT_AGENT_MODEL when the dynamic catalog is down.
 * If AnyRouter itself is not configured, drop to resolveDefaultAgentModel()
 * so we do not hard-fail on a stale client default of `anyrouter:auto`.
 */
export async function resolveAgentModel(
  bodyModel: string | undefined
): Promise<string> {
  const configuredModel = process.env.LLM_MODEL?.trim()
  let model =
    typeof bodyModel === 'string' && bodyModel.trim().length > 0
      ? bodyModel.trim()
      : configuredModel || resolveDefaultAgentModel()

  if (isAnyRouterAutoModelId(model)) {
    if (!isProviderConfigured('anyrouter')) {
      model = resolveDefaultAgentModel()
    } else {
      const top = await resolveAnyRouterAutoModelId()
      // Fail-soft to curated static default (not `anyrouter:auto` again).
      model = top ?? DEFAULT_AGENT_MODEL
    }
  }

  return model
}

/**
 * Best-effort Clerk caller id for OpenRouter user tracking and the
 * per-identity rate limit. Anonymous / non-Clerk deployments resolve to
 * `guest`. Cloud guests are remapped in `handlePost` to a per-IP
 * `guest:<hash>` before attribution / RL / the usage gate.
 */
export async function resolveAgentUserId(): Promise<string> {
  if (!isClerkAuthProvider()) return 'guest'

  try {
    const { auth } = await import('@clerk/tanstack-react-start/server')
    const authResult = await auth()
    if (authResult?.userId) return authResult.userId
  } catch {
    // Clerk session unavailable
  }

  return 'guest'
}

/**
 * Flatten the sanitized incoming history into the UI-message list, then thread
 * a lightweight "the user is looking at page X" hint ahead of the user's turn
 * — only on the first message of a (new) thread, so a long-running
 * conversation doesn't keep re-asserting page context after the user has
 * navigated away. The client only sends `pageContext` on the first turn or
 * when the page changed; this is a server-side belt-and-braces check against
 * the same signal (a single user turn in the incoming history). Deliberately
 * NOT folded into `AGENT_JSON_RENDER_INLINE_PROMPT` (the cached system prompt)
 * — inserted as its own message instead, so provider prompt caching on the
 * system prompt is unaffected.
 *
 * The hint is threaded in with `role: 'user'`, never `'system'`: the AI SDK's
 * `ToolLoopAgent`/`streamText` reject any `system`-role entry inside
 * `messages` (`allowSystemInMessages` defaults to `false` — see
 * `standardizePrompt` in the `ai` package), throwing `AI_InvalidPromptError`.
 * Because `pageContext` is only present on the first turn, a `'system'` role
 * here made every brand-new session's first message fail outright (caught,
 * classified, and streamed back as a masked error part instead of a real
 * reply) while every later message — with no `pageContext` — worked fine.
 * The extra `'user'`-role line is never echoed back to the client (the
 * response stream only carries new assistant content), so it does not appear
 * as a stray chat bubble.
 */
export function buildUiMessages(options: {
  safeIncomingMessages: ReadonlyArray<SafeAgentMessage>
  userMessage: string | undefined
  pageContext: SafePageContext | undefined
  hostId: number
}): AgentUiMessage[] {
  const { safeIncomingMessages, userMessage, pageContext, hostId } = options
  const uiMessages: AgentUiMessage[] = []

  for (const msg of safeIncomingMessages) {
    if (msg.parts.length > 0) {
      uiMessages.push({ id: msg.id, role: msg.role, parts: msg.parts })
    } else if (msg.content) {
      uiMessages.push({
        id: msg.id,
        role: msg.role,
        parts: [{ type: 'text' as const, text: msg.content }],
      })
    }
  }

  if (uiMessages.length === 0 && userMessage) {
    uiMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text' as const, text: userMessage }],
    })
  }

  const isFirstThreadMessage =
    safeIncomingMessages.filter((m) => m.role === 'user').length <= 1
  if (pageContext && isFirstThreadMessage) {
    const lastMessageIndex = uiMessages.length - 1
    if (lastMessageIndex >= 0 && uiMessages[lastMessageIndex].role === 'user') {
      uiMessages.splice(lastMessageIndex, 0, {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [
          {
            type: 'text' as const,
            text: buildPageContextLine(pageContext, hostId),
          },
        ],
      })
    }
  }

  return uiMessages
}

export type AgentRuntime = {
  agent: ReturnType<typeof createClickHouseAgent>
  mcpCloseAll: (() => Promise<void>) | null
}

/**
 * Connect the user's custom MCP servers and create the agent.
 *
 * Called only once all early (402 / validation) returns are behind us, so a
 * rejected request never opens — and then leaks — an MCP client. Request-body
 * servers are merged with the user's D1-persisted registrations (loaded
 * per-user, best-effort — [] for guest / no D1) and deduped by endpoint so the
 * same server is never connected twice (which would collide tool keys and
 * bypass the per-call cap). `closeAll()` runs in the stream's `onEnd` (and on
 * a pre-stream throw below).
 *
 * On a pre-stream failure no stream is ever created, so onEnd/onError won't
 * run: close any MCP clients we just opened AND release the daily quota
 * reservation (issue #2675 — a failed request must not permanently burn one of
 * the user's daily message slots) before rethrowing to the outer boundary.
 */
export async function createAgentRuntime(options: {
  userId: string
  requestMcpServers: CustomMcpServerInput[]
  hostId: number
  model: string
  disabledTools: string[]
  openRouterUser: string
  requestOrigin: string | undefined
  includeControlTools: boolean
  sessionId: string
  byokApiKey: string | null
  releaseReservationOnce: () => Promise<void>
}): Promise<AgentRuntime> {
  let mcpCloseAll: (() => Promise<void>) | null = null
  let extraTools: Record<string, unknown> | undefined

  try {
    const registeredServers = isGuestOwnerId(options.userId)
      ? []
      : await loadUserRegisteredServers(options.userId)
    const mergedMcpServers = mergeMcpServers(
      options.requestMcpServers,
      registeredServers
    )
    if (mergedMcpServers.length > 0) {
      const mcpResult = await connectCustomMcpServers(mergedMcpServers)
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

    const agent = createClickHouseAgent({
      hostId: options.hostId,
      model: options.model,
      disabledTools: options.disabledTools,
      systemPrompt: AGENT_JSON_RENDER_INLINE_PROMPT,
      providerOptions: { openrouter: { user: options.openRouterUser } },
      referer: options.requestOrigin,
      includeControlTools: options.includeControlTools,
      sessionId: options.sessionId,
      extraTools,
      ...(options.byokApiKey ? { apiKey: options.byokApiKey } : {}),
    })

    return { agent, mcpCloseAll }
  } catch (error) {
    if (mcpCloseAll) await mcpCloseAll().catch(() => {})
    await options.releaseReservationOnce().catch(() => {})
    throw error
  }
}
