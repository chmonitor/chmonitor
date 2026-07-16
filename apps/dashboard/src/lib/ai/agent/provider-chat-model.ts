/**
 * OpenAI-compatible chat model resolution for agent routes.
 *
 * Keeps provider setup shared between the streaming agent and small
 * one-off generations such as follow-up suggestions.
 */

import type { LanguageModel } from 'ai'

import { resolveDefaultAgentModel } from '../agent-model-registry'
import { parseModelId, resolveProvider } from '../providers'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnyRouter } from '@anyr/ai-sdk-provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export const DEFAULT_MODEL =
  process.env.LLM_MODEL?.trim() || resolveDefaultAgentModel()

export const DEFAULT_APP_REFERER = 'https://chmonitor.dev'
export const DEFAULT_APP_NAME = 'chmonitor'
export const DEFAULT_APP_SOURCE = 'chmonitor'
export const DEFAULT_APP_CATEGORY = 'programming-app'
export const DEFAULT_APP_VERSION = '0.2.0'

function getOpenRouterFreeFallbackModel(): string {
  return (
    process.env.OPENROUTER_FREE_FALLBACK_MODEL?.trim() ||
    'qwen/qwen3-coder:free'
  )
}

function isAnthropicModel(model: string): boolean {
  const lower = model.toLowerCase()
  return (
    lower.startsWith('anthropic/') || /(^|[/_-])claude([/_-]|$)/.test(lower)
  )
}

/**
 * Resolve app attribution metadata from env + defaults.
 * `APP_*` is the canonical name; `OPENROUTER_*` is supported as a fallback
 * so existing deployments that set the older vars keep working.
 */
function getAppMetadata(referer?: string) {
  return {
    referer:
      referer ||
      process.env.APP_REFERER ||
      process.env.OPENROUTER_REFERER ||
      DEFAULT_APP_REFERER,
    name:
      process.env.APP_NAME ||
      process.env.OPENROUTER_APP_NAME ||
      DEFAULT_APP_NAME,
    source: process.env.APP_SOURCE?.trim() || DEFAULT_APP_SOURCE,
    category: process.env.APP_CATEGORY || DEFAULT_APP_CATEGORY,
    version: process.env.APP_VERSION || DEFAULT_APP_VERSION,
  }
}

function getAnyRouterHeaders(referer?: string): Record<string, string> {
  const meta = getAppMetadata(referer)
  // X-AnyRouter-Source is the app identifier AnyRouter groups rankings by (its
  // curation matches this against `chmonitor`); the marketplace category goes in
  // X-AnyRouter-Categories. Keep them separate — sending the category as the
  // source makes AnyRouter attribute usage to `programming-app` instead of
  // chmonitor.dev.
  return {
    'HTTP-Referer': meta.referer,
    'X-AnyRouter-Title': meta.name,
    'X-AnyRouter-Source': meta.source,
    'X-AnyRouter-Categories': meta.category,
    'X-AnyRouter-Version': meta.version,
  }
}

export interface ResolvedAgentChatModel {
  readonly model: LanguageModel
  readonly modelId: string
  readonly providerId: string
}

export function resolveAgentChatModel({
  model = DEFAULT_MODEL,
  hasTools = false,
  referer,
  apiKey,
}: {
  readonly model?: string
  readonly hasTools?: boolean
  readonly referer?: string
  /**
   * BYOK — a user-supplied provider API key. When present it overrides the
   * deployment's env key for this request (see `agent/byok.ts`). The caller
   * is responsible for skipping included-credit metering when BYOK is active.
   */
  readonly apiKey?: string
}): ResolvedAgentChatModel {
  const resolved = resolveProvider(model, apiKey)
  const { model: modelId } = parseModelId(model)

  if (resolved.isOpenRouter) {
    const meta = getAppMetadata(referer)
    const openrouter = createOpenRouter({
      apiKey: resolved.apiKey,
      headers: {
        'HTTP-Referer': meta.referer,
        'X-OpenRouter-Title': meta.name,
        'X-OpenRouter-Categories': meta.category,
      },
    })

    // Strip 'openrouter/' prefix for OpenRouter's chat model resolution.
    // Map `openrouter/free` to a concrete free tool-capable model.
    const normalizedModelId = modelId.startsWith('openrouter/')
      ? modelId.replace('openrouter/', '')
      : modelId
    const resolvedModelId =
      normalizedModelId === 'free'
        ? getOpenRouterFreeFallbackModel()
        : normalizedModelId
    if (normalizedModelId === 'free') {
      console.warn(
        `[Agent] openrouter/free resolved to fallback: ${resolvedModelId}`
      )
    }

    const usePromptCache = isAnthropicModel(resolvedModelId)
    if (usePromptCache) {
      console.debug(
        `[Agent] Prompt caching enabled for Anthropic model: ${resolvedModelId}`
      )
    }

    return {
      model: openrouter.chat(resolvedModelId, {
        ...(hasTools && { provider: { require_parameters: true } }),
        ...(usePromptCache && { cache_control: { type: 'ephemeral' } }),
      }) as LanguageModel,
      modelId: resolvedModelId,
      providerId: resolved.providerId,
    }
  }

  if (resolved.providerId === 'anyrouter') {
    // Mirror the OpenRouter+Anthropic prompt-caching path: for
    // Anthropic-compatible models routed through AnyRouter, attach
    // `cache_control: { type: 'ephemeral' }` so the ~8K-token system prompt is
    // cached instead of re-billed on every tool-loop step. The AnyRouter
    // callable takes no per-model settings arg (unlike `openrouter.chat`), so
    // the hint is forwarded via the provider's `extraBody` request-body hook.
    // Safe no-op if AnyRouter ignores it — the route logs `cacheReadTokens` to
    // confirm when it takes effect.
    const usePromptCache = isAnthropicModel(modelId)
    if (usePromptCache) {
      console.debug(
        `[Agent] Prompt caching enabled for Anthropic model: ${modelId}`
      )
    }
    const anyrouter = createAnyRouter({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      headers: getAnyRouterHeaders(referer),
      ...(usePromptCache && {
        extraBody: { cache_control: { type: 'ephemeral' } },
      }),
    })
    return {
      model: anyrouter(modelId) as LanguageModel,
      modelId,
      providerId: resolved.providerId,
    }
  }

  const openai = createOpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
  })

  return {
    model: openai.chat(modelId) as LanguageModel,
    modelId,
    providerId: resolved.providerId,
  }
}
