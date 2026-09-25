/**
 * Agent Analytics Utilities
 *
 * Aggregates token usage and estimates cost across agent steps.
 * Used server-side for logging and client-side for display.
 */

import type { LanguageModelUsage } from 'ai'

// ============================================================================
// Types
// ============================================================================

export interface AgentUsageStats {
  /** Total input (prompt) tokens across all steps */
  totalInputTokens: number
  /** Total output (completion) tokens across all steps */
  totalOutputTokens: number
  /** Total tokens (input + output) */
  totalTokens: number
  /** Tokens read from prompt cache */
  cacheReadTokens: number
  /** Tokens written to prompt cache */
  cacheWriteTokens: number
  /** Reasoning tokens generated */
  reasoningTokens: number
  /** Number of LLM steps completed */
  stepCount: number
  /** Estimated cost in USD, or null if model is unknown */
  estimatedCostUsd: number | null
}

// ============================================================================
// Pricing table
// ============================================================================

/**
 * Per-million-token pricing for known models.
 * Format: [inputPricePerMillion, outputPricePerMillion]
 *
 * `null` in either slot means **no published fixed per-token rate** — a router
 * that bills at whatever model it picks (`openrouter/auto`), a credit-billed
 * provider (NVIDIA NIM), or a workspace preset. That is deliberately distinct
 * from `0`, which means genuinely free: a `null` rate makes
 * {@link estimateCost} return `null` ("unknown") so the UI can say so, whereas
 * `0` would assert a paid model costs nothing.
 *
 * Every `MODEL_REGISTRY` id must appear here, and must agree with that
 * entry's `ModelEntry.pricing` — asserted by
 * `__tests__/model-registry-consistency.test.ts`. Other rows here are
 * historical: the estimate may still run for a model a user has selected from
 * a persisted conversation, so they are kept rather than pruned.
 */
export const MODEL_PRICING: Record<string, [number | null, number | null]> = {
  // OpenRouter meta-routers
  'openrouter/free': [0, 0],
  'openrouter/auto': [null, null],

  // AnyRouter presets — billed by the preset's routed model
  '@preset/chmonitor': [null, null],

  // Free tier models (tool-use capable)
  'z-ai/glm-4.5-air:free': [0, 0],
  'openai/gpt-oss-120b:free': [0, 0],
  'openai/gpt-oss-20b:free': [0, 0],
  'qwen/qwen3-coder:free': [0, 0],
  'qwen/qwen3-next-80b-a3b-instruct:free': [0, 0],
  'meta-llama/llama-3.3-70b-instruct:free': [0, 0],
  'google/gemma-4-31b-it:free': [0, 0],
  'google/gemma-4-26b-a4b-it:free': [0, 0],
  'nvidia/nemotron-3-super-120b-a12b:free': [0, 0],
  'qwen/qwen3.8-27b:free': [0, 0],
  'arcee-ai/trinity-large-preview:free': [0, 0],

  // ── Curated registry (kept in sync by model-registry-consistency.test.ts) ──
  'anthropic/claude-opus-5.5': [4, 20],
  'openai/gpt-6-sol': [2, 10],
  'openai/gpt-6-luna': [0.1, 0.5],
  'x-ai/grok-4.7': [1.6, 4.8],
  'z-ai/glm-5.3': [1.4, 4.4],
  'z-ai/glm-5.3-flash': [0.045, 0.14],
  'moonshotai/kimi-k3': [3, 15],
  'deepseek/deepseek-v4.1-flash': [0.15, 0.6],
  'google/gemini-3.1-flash-lite': [0.25, 1.5],
  'google/gemma-4-26b-a4b-it': [0.0675, 0.225],
  'qwen/qwen3.5-397b-a17b': [0.55, 3.5],
  'openai/gpt-oss-120b': [0.15, 0.6],
  'openai/gpt-oss-20b': [0.018, 0.09],
  'nvidia/nemotron-3-ultra-550b-a55b': [0.6, 2.4],
  'nvidia/nemotron-3-super-120b-a12b': [0.08, 0.45],
  // Credit-billed: no published per-token rate.
  'nvidia/llama-3.1-nemotron-70b-instruct': [null, null],
  'nvidia/llama-3.1-nemotron-51b-instruct': [null, null],
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': [null, null],
  'nvidia/nemotron-4-340b-instruct': [null, null],

  // Historical rows — a persisted conversation may still select these.
  'openai/gpt-4o': [2.5, 10],
  'openai/gpt-4o-mini': [0.15, 0.6],
  'openai/o1': [15, 60],
  'openai/o1-mini': [3, 12],
  'openai/o3-mini': [1.1, 4.4],
  'openai/o4-mini': [1.1, 4.4],
  'anthropic/claude-3-5-sonnet': [3, 15],
  'anthropic/claude-3-5-haiku': [0.8, 4],
  'anthropic/claude-3-7-sonnet': [3, 15],
  'anthropic/claude-opus-4': [15, 75],
  'anthropic/claude-sonnet-4-5': [3, 15],
  'google/gemini-2.0-flash': [0.1, 0.4],
  'google/gemini-2.5-pro': [1.25, 10],
  'google/gemini-2.0-flash-lite': [0.075, 0.3],
  'google/gemma-4-31b-it': [0.09, 0.34],
  'z-ai/glm-4.7-flash': [0.0605, 0.4],
  'moonshotai/kimi-k2.6': [0.95, 4],
  'meta-llama/llama-3.3-70b-instruct': [0.1, 0.32],
  'meta-llama/llama-3.1-8b-instruct': [0.055, 0.055],
  'mistralai/mistral-small': [0.1, 0.3],
  'mistralai/mistral-large': [2, 6],
  'qwen/qwen-2.5-72b-instruct': [0.35, 0.4],
  'x-ai/grok-4.5': [2, 6],
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Aggregate token usage across multiple LLM steps.
 *
 * @param steps - Array of LanguageModelUsage from each step
 * @returns Summed usage statistics (model-agnostic, no cost estimate)
 */
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

/**
 * Estimate cost in USD for a given usage and model.
 *
 * Returns null for unknown models. Returns 0 for free models.
 * Uses cache-read tokens at a 0.1× discount when pricing is available.
 *
 * @param usage - Aggregated usage stats
 * @param model - Model identifier string (e.g. "openai/gpt-4o")
 * @returns Estimated USD cost, or null if model is not in the pricing table
 */
export function estimateCost(
  usage: AgentUsageStats,
  model: string
): number | null {
  // Normalize the model string — strip `provider:` prefix from new format.
  // Only strip recognized provider prefixes to avoid breaking model IDs
  // that contain `:` (e.g., `qwen/qwen3-coder:free`).
  const KNOWN_PREFIXES = ['openrouter:', 'nvidia:', 'anyrouter:']
  let normalizedModel = model.trim().toLowerCase()
  for (const prefix of KNOWN_PREFIXES) {
    if (normalizedModel.startsWith(prefix)) {
      normalizedModel = normalizedModel.slice(prefix.length)
      break
    }
  }

  const pricing = MODEL_PRICING[normalizedModel]

  // Check for :free suffix pattern not in table
  if (!pricing) {
    if (normalizedModel.endsWith(':free')) return 0
    return null
  }

  const [inputPrice, outputPrice] = pricing

  // Explicit `null` = no published fixed per-token rate (router, credit-billed
  // provider, workspace preset). Report "unknown" rather than inventing a cost.
  if (inputPrice === null || outputPrice === null) return null

  // Free model
  if (inputPrice === 0 && outputPrice === 0) return 0

  const PER_MILLION = 1_000_000

  // Non-cached input tokens
  const noCacheInput =
    usage.totalInputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
  const inputCost = (Math.max(0, noCacheInput) / PER_MILLION) * inputPrice

  // Cache read at 0.1× rate (common discount)
  const cacheReadCost = (usage.cacheReadTokens / PER_MILLION) * inputPrice * 0.1

  // Cache write at 1.25× rate (common surcharge)
  const cacheWriteCost =
    (usage.cacheWriteTokens / PER_MILLION) * inputPrice * 1.25

  const outputCost = (usage.totalOutputTokens / PER_MILLION) * outputPrice

  return inputCost + cacheReadCost + cacheWriteCost + outputCost
}

/**
 * Aggregate usage across steps and attach cost estimate.
 *
 * Convenience wrapper combining aggregateUsage + estimateCost.
 */
export function aggregateUsageWithCost(
  steps: LanguageModelUsage[],
  model: string
): AgentUsageStats {
  const stats = aggregateUsage(steps)
  return { ...stats, estimatedCostUsd: estimateCost(stats, model) }
}
