import type { LanguageModelUsage } from 'ai'

export interface AgentUsageStats {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  stepCount: number
  estimatedCostUsd: number | null
}

/**
 * Per-million-token pricing for known models.
 * Format: [inputPricePerMillion, outputPricePerMillion]
 *
 * Keys are bare model ids — `estimateCost` strips the `provider:` prefix.
 * This table is deliberately broader than `MODEL_REGISTRY` (it also prices
 * dynamically discovered models that never reach the curated floor); the
 * registry's own `pricing` must agree with the row here, which
 * `agent-model-consistency.test.ts` enforces.
 *
 * Free models (`:free` suffix) are $0. Auto-routers (`openrouter/auto`,
 * `anyrouter:auto`) have no fixed rate — the upstream model is chosen per
 * request, and OpenRouter quotes an explicit -1 sentinel — so they are absent,
 * as are own-key NIM models the deployment bills directly.
 *
 * Curated-row rates were read from each provider's public catalog
 * (OpenRouter `/api/v1/models`, AnyRouter `/api/v1/models`) on 2026-09-26;
 * see `agent-model-registry.ts` for the per-entry provenance.
 */
export const MODEL_PRICING: Record<string, [number, number]> = {
  // Auto-routers are variable-cost and deliberately unpriced
  'openrouter/free': [0, 0],

  'openai/gpt-oss-120b:free': [0, 0],
  'openai/gpt-oss-20b:free': [0, 0],
  'google/gemma-4-26b-a4b-it:free': [0, 0],
  'google/gemma-4-31b-it:free': [0, 0],
  'qwen/qwen3.8-27b:free': [0, 0],
  'nvidia/nemotron-3-super-120b-a12b:free': [0, 0],

  'openai/gpt-4o': [2.5, 10],
  'openai/gpt-4o-mini': [0.15, 0.6],
  'openai/o1': [15, 60],
  'openai/o1-mini': [3, 12],
  'openai/o3-mini': [1.1, 4.4],
  'openai/o4-mini': [1.1, 4.4],
  'openai/gpt-oss-120b': [0.15, 0.6],
  'openai/gpt-oss-20b': [0.018, 0.09],

  'anthropic/claude-3-5-sonnet': [3, 15],
  'anthropic/claude-3-5-haiku': [0.8, 4],
  'anthropic/claude-3-7-sonnet': [3, 15],
  'anthropic/claude-opus-4': [15, 75],
  'anthropic/claude-sonnet-4-5': [3, 15],

  'google/gemini-2.0-flash': [0.1, 0.4],
  'google/gemini-2.5-pro': [1.25, 10],
  'google/gemini-2.0-flash-lite': [0.075, 0.3],
  'google/gemini-3.1-flash-lite': [0.25, 1.5],
  'google/gemma-4-26b-a4b-it': [0.0675, 0.225],
  'google/gemma-4-31b-it': [0.15, 0.45],

  'meta-llama/llama-3.3-70b-instruct': [0.59, 0.79],
  'meta-llama/llama-3.1-8b-instruct': [0.055, 0.055],

  'mistralai/mistral-small': [0.1, 0.3],
  'mistralai/mistral-large': [2, 6],

  'qwen/qwen-2.5-72b-instruct': [0.35, 0.4],
  'qwen/qwen3.5-397b-a17b': [0.55, 3.5],

  'deepseek/deepseek-v4-flash': [0.042448, 0.084896],
  'deepseek/deepseek-v4.1-flash': [0.155, 0.62],
  'moonshotai/kimi-k2.6': [0.95, 4],
  'moonshotai/kimi-k3': [3, 15],

  'z-ai/glm-4.7-flash': [0.0605, 0.4],
  'z-ai/glm-5.3-flash': [0.045, 0.14],

  'x-ai/grok-4.5': [2.0, 6.0],
  'x-ai/grok-4.7': [1.6, 4.8],
}

export function aggregateUsage(steps: LanguageModelUsage[]): AgentUsageStats {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0

  for (const usage of steps) {
    totalInputTokens += usage.inputTokens ?? 0
    totalOutputTokens += usage.outputTokens ?? 0
    totalTokens += usage.totalTokens ?? 0
    cacheReadTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0
    cacheWriteTokens += usage.inputTokenDetails?.cacheWriteTokens ?? 0
    reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    stepCount: steps.length,
    estimatedCostUsd: null,
  }
}

// Null for unknown models, 0 for free ones; cache reads are priced at 0.1x when the table has a rate.
export function estimateCost(
  usage: AgentUsageStats,
  model: string
): number | null {
  // Only strip recognized provider prefixes: some model ids contain `:` (e.g. `qwen/qwen3-coder:free`).
  const KNOWN_PREFIXES = ['openrouter:', 'nvidia:', 'anyrouter:']
  let normalizedModel = model.trim().toLowerCase()
  for (const prefix of KNOWN_PREFIXES) {
    if (normalizedModel.startsWith(prefix)) {
      normalizedModel = normalizedModel.slice(prefix.length)
      break
    }
  }

  const pricing = MODEL_PRICING[normalizedModel]

  if (!pricing) {
    if (normalizedModel.endsWith(':free')) return 0
    return null
  }

  const [inputPrice, outputPrice] = pricing

  if (inputPrice === 0 && outputPrice === 0) return 0

  const PER_MILLION = 1_000_000

  const noCacheInput =
    usage.totalInputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
  const inputCost = (Math.max(0, noCacheInput) / PER_MILLION) * inputPrice

  const cacheReadCost = (usage.cacheReadTokens / PER_MILLION) * inputPrice * 0.1

  const cacheWriteCost =
    (usage.cacheWriteTokens / PER_MILLION) * inputPrice * 1.25

  const outputCost = (usage.totalOutputTokens / PER_MILLION) * outputPrice

  return inputCost + cacheReadCost + cacheWriteCost + outputCost
}

export function aggregateUsageWithCost(
  steps: LanguageModelUsage[],
  model: string
): AgentUsageStats {
  const stats = aggregateUsage(steps)
  return { ...stats, estimatedCostUsd: estimateCost(stats, model) }
}
