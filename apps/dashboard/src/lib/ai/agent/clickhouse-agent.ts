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

const DEFAULT_MAX_STEPS = 30

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
      ? resolveAgentChatModel({ model, hasTools, referer }).model
      : model

  return new ToolLoopAgent({
    id: 'clickhouse-agent',
    model: modelInstance,
    tools,
    instructions: systemPrompt,
    stopWhen: isStepCount(maxSteps),
    ...(providerOptions && { providerOptions }),
  })
}
