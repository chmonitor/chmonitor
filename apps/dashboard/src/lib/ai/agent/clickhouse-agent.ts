/**
 * ClickHouse AI Agent using AI SDK ToolLoopAgent
 *
 * A native AI SDK agent for querying ClickHouse using natural language.
 * Supports multiple LLM providers (OpenRouter, NVIDIA NIM, AnyRouter)
 * via the provider registry.
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'

import { CLICKHOUSE_AGENT_INSTRUCTIONS } from './prompts/clickhouse-instructions'
import { DEFAULT_MODEL, resolveAgentChatModel } from './provider-chat-model'
import { wrapToolsWithLogging } from './tool-logging'
import { createAllTools } from './tools'
import { isStepCount, type LanguageModel, ToolLoopAgent } from 'ai'

function filterTools<T extends Record<string, unknown>>(
  tools: T,
  disabledTools: string[]
): T {
  if (disabledTools.length === 0) return tools
  const filtered = { ...tools }
  for (const name of disabledTools) {
    delete filtered[name as keyof T]
  }
  return filtered
}

/** Bound wandering. Override per request via `maxSteps`. */
export const DEFAULT_MAX_STEPS = 16

export function createClickHouseAgent(options: {
  /**
   * Model ID in `provider:model` format (e.g., `openrouter:openrouter/free`),
   * or a pre-resolved `LanguageModel` instance. The instance form is a test
   * seam only — e.g. passing `ai/test`'s `MockLanguageModelV3` to drive the
   * real tool loop deterministically without a live LLM (see
   * `__tests__/scenarios.test.ts`). All production callers pass a string, so
   * this branch does not change their behavior.
   */
  model?: string | LanguageModel
  maxSteps?: number
  hostId: number
  disabledTools?: string[]
  systemPrompt?: string
  providerOptions?: ProviderOptions
  /** Origin of the calling request — passed as OpenRouter HTTP-Referer. */
  referer?: string
  includeControlTools?: boolean
  /** Session / conversation ID for structured log correlation. */
  sessionId?: string
  /** Additional tools from connected custom MCP servers (prefixed mcp_*). */
  extraTools?: Record<string, unknown>
  /**
   * BYOK — a user-supplied provider API key. Overrides the deployment's env
   * key for this request (see `byok.ts`). Only applied when `model` is a
   * string (the production path); ignored for a pre-resolved model instance.
   */
  apiKey?: string
}) {
  const {
    model = DEFAULT_MODEL,
    maxSteps = DEFAULT_MAX_STEPS,
    hostId,
    disabledTools = [],
    systemPrompt = CLICKHOUSE_AGENT_INSTRUCTIONS,
    providerOptions,
    referer,
    includeControlTools = false,
    sessionId = crypto.randomUUID(),
    extraTools,
    apiKey,
  } = options

  const allTools = createAllTools(hostId, includeControlTools)
  const filteredTools = filterTools(allTools, disabledTools)
  // Wrap each tool's execute to emit structured logs (toolName, durationMs, etc.)
  // Built-in tools take precedence over MCP tools on key collision (mcp_ prefix
  // prevents collisions in practice).
  const mergedTools = extraTools
    ? { ...extraTools, ...filteredTools }
    : filteredTools
  const tools = wrapToolsWithLogging(mergedTools, sessionId)
  const hasTools = Object.keys(tools).length > 0
  const modelInstance =
    typeof model === 'string'
      ? resolveAgentChatModel({ model, hasTools, referer, apiKey }).model
      : model

  return new ToolLoopAgent({
    id: 'clickhouse-agent',
    model: modelInstance,
    tools,
    instructions: systemPrompt,
    // Cap wandering at maxSteps, but never treat a step that emitted
    // tool calls as terminal. Some OpenAI-compat providers (Gemma) send
    // finishReason "stop" on the same step as a tool call; the SDK still
    // continues when those calls are recorded as client outputs. This
    // guard keeps isStepCount from ending the loop early if a step is
    // counted before tools are folded into the next model turn.
    stopWhen: stopWhenIdleOrMaxSteps(maxSteps),
    ...(providerOptions && { providerOptions }),
  })
}

/**
 * Stop only when the step cap is reached, or when the latest step did not
 * emit tool calls (the SDK already stops then). A tool-bearing step always
 * continues until `maxSteps`.
 */
export function stopWhenIdleOrMaxSteps(maxSteps: number) {
  const atCap = isStepCount(maxSteps)
  return ({ steps }: { steps: Array<{ toolCalls?: unknown[] }> }) => {
    const last = steps[steps.length - 1]
    if (last?.toolCalls && last.toolCalls.length > 0 && steps.length < maxSteps) {
      return false
    }
    return atCap({ steps })
  }
}
