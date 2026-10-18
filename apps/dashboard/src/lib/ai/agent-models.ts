/**
 * Shared agent model metadata for both client and server code.
 *
 * Re-exports types and helpers from the model registry.
 * The static AGENT_MODELS object is kept for backward compatibility
 * with code that hasn't migrated to MODEL_REGISTRY yet.
 */

import {
  isFreeAgentModel as isFreeAgentModelImpl,
  MODEL_REGISTRY,
  type ModelEntry,
} from './agent-model-registry'
import { formatCompactNumber } from '@/lib/format-number'

export type { ModelEntry }

/**
 * Backward-compatible static model map.
 * Derived from MODEL_REGISTRY. Use MODEL_REGISTRY directly for new code.
 */
export const AGENT_MODELS = Object.fromEntries(
  MODEL_REGISTRY.map((entry) => [
    entry.id,
    {
      name: entry.id,
      description: entry.description,
      contextLength: entry.contextLength,
      ...('pricing' in entry && entry.pricing
        ? { pricing: entry.pricing }
        : {}),
    },
  ])
) as Record<
  string,
  {
    name: string
    description: string
    contextLength: number
    pricing?: { inputPerMillion: number; outputPerMillion: number }
  }
>

/** OpenAI-compatible model identifier. */
export type OpenAIModel = string

export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

export function formatTokenCount(count: number): string {
  return formatCompactNumber(count)
}

export const isFreeAgentModel = isFreeAgentModelImpl
