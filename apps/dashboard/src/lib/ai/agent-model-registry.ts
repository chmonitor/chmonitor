/**
 * Agent Model Registry
 *
 * Curated list of models grouped by provider availability.
 * The dropdown generates `provider:model` combinations from this.
 */

export interface ModelEntry {
  /** Provider-agnostic model ID (e.g., 'qwen/qwen3.5-397b-a17b') */
  id: string
  /** Human-readable description */
  description: string
  /** Context window in tokens */
  contextLength: number
  /** Per-million-token pricing (omit for free/own-key models) */
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  /** Which provider IDs can serve this model */
  providers: string[]
}

// NOTE: do not default to `anyrouter:@preset/chmonitor` until the preset
// is rerouted away from `z-ai/glm-4.7-flash`. That model emits prose that
// *describes* tool calls instead of producing structured tool_calls, so the
// agent loop exits after step 1 with no tools ever invoked (verified
// 2026-05-27 against /api/v1/agent). Gemma 4 26B via AnyRouter completes a
// full two-step tool loop cleanly and stays effectively free.
export const DEFAULT_AGENT_MODEL = 'anyrouter:google/gemma-4-26b-a4b-it'

/**
 * Fallback default when AnyRouter is not configured. OpenRouter's free
 * auto-router only requires LLM_API_KEY (the documented minimum AI setup),
 * so it works in deployments that haven't opted in to AnyRouter.
 */
export const FALLBACK_AGENT_MODEL = 'openrouter/free'

/**
 * Resolve the best default model for the current deployment.
 *
 * Server-only — reads provider env vars.
 *
 * When AnyRouter is configured, prefer `anyrouter:auto` — the models endpoint
 * and agent route resolve it to the current top tool-capable model by
 * AnyRouter usage (`request_count`), falling back to {@link DEFAULT_AGENT_MODEL}
 * (curated Gemma) if the dynamic catalog is unavailable.
 *
 * If AnyRouter is not configured, fall back to OpenRouter's free auto-router
 * which works with the documented `LLM_API_KEY`-only setup.
 */
export function resolveDefaultAgentModel(): string {
  if (process.env.ANYROUTER_API_KEY) {
    // Lazy import-free constant — keep registry free of the dynamic module
    // cycle (dynamic-models imports isFreeAgentModel from this file).
    return 'anyrouter:auto'
  }
  if (process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY) {
    return FALLBACK_AGENT_MODEL
  }
  // No provider configured — return the curated static default; the caller's
  // provider preflight will surface a clear 503 if it actually runs.
  return DEFAULT_AGENT_MODEL
}

export const MODEL_REGISTRY: readonly ModelEntry[] = [
  // ── Presets (auto-routing via AnyRouter) ──
  {
    id: '@preset/chmonitor',
    description: 'Preset: chmonitor agent routing',
    contextLength: 200_000,
    providers: ['anyrouter'],
  },

  // ── OpenRouter auto-routers ──
  {
    id: 'openrouter/free',
    description: 'Auto-router: free tool-capable model',
    contextLength: 200_000,
    providers: ['openrouter'],
  },
  {
    id: 'openrouter/auto',
    description: 'Auto-router: best available (paid)',
    contextLength: 2_000_000,
    providers: ['openrouter'],
  },

  // ── Free-tier (OpenRouter only) ──
  {
    id: 'qwen/qwen3-coder:free',
    description: 'Qwen3 Coder, 1M context',
    contextLength: 1_048_576,
    providers: ['openrouter'],
  },
  {
    id: 'z-ai/glm-4.5-air:free',
    description: 'GLM 4.5 Air',
    contextLength: 131_072,
    providers: ['openrouter'],
  },
  {
    id: 'google/gemma-4-31b-it:free',
    description: 'Gemma 4 31B IT',
    contextLength: 262_144,
    providers: ['openrouter'],
  },

  // ── Paid: multi-provider ──
  {
    id: 'qwen/qwen3.5-397b-a17b',
    description: 'Qwen 3.5 397B MoE',
    contextLength: 131_072,
    pricing: { inputPerMillion: 0.35, outputPerMillion: 0.4 },
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },
  {
    id: 'z-ai/glm-4.7-flash',
    description: 'GLM 4.7 Flash',
    contextLength: 131_072,
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    description: 'Gemini 3.1 Flash Lite',
    contextLength: 1_000_000,
    pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
    providers: ['anyrouter'],
  },
  {
    id: 'google/gemma-4-26b-a4b-it',
    description: 'Gemma 4 26B IT',
    contextLength: 262_144,
    providers: ['openrouter', 'anyrouter'],
  },
  {
    id: 'x-ai/grok-4.5',
    description: 'Grok 4.5',
    contextLength: 262_144,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 },
    providers: ['openrouter', 'anyrouter'],
  },

  // ── NVIDIA-only ──
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    description: 'Nemotron 70B Instruct',
    contextLength: 131_072,
    providers: ['nvidia'],
  },
]

/**
 * Parse extra models from the `LLM_EXTRA_MODELS` environment variable.
 *
 * Format: comma-separated entries, each in the form:
 *   `provider:modelId[|contextLength][|description]`
 *
 * Examples:
 *   `nvidia:meta/llama-3.3-70b|131072|Llama 3.3 70B`
 *   `openrouter:x-ai/grok-2`
 *
 * - `provider` is the substring before the FIRST colon.
 * - `modelId` is everything after that first colon (may itself contain colons,
 *   e.g. `qwen/qwen3-coder:free`).
 * - `contextLength` (optional, second pipe segment) — integer token count;
 *   defaults to 128 000.
 * - `description` (optional, third pipe segment) — display label;
 *   defaults to the model ID.
 *
 * Malformed or empty entries are silently skipped.
 */
export function parseExtraModels(): ModelEntry[] {
  const raw = process.env.LLM_EXTRA_MODELS?.trim()
  if (!raw) return []

  const entries: ModelEntry[] = []

  for (const segment of raw.split(',')) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const parts = trimmed.split('|')
    const providerAndModel = parts[0]?.trim()
    if (!providerAndModel) continue

    // provider = substring before FIRST colon; modelId = rest
    const colonIdx = providerAndModel.indexOf(':')
    if (colonIdx <= 0) continue // no colon, or colon is first char

    const provider = providerAndModel.slice(0, colonIdx).trim()
    const modelId = providerAndModel.slice(colonIdx + 1).trim()
    if (!provider || !modelId) continue

    const rawContextLength = parts[1]?.trim()
    const contextLength = rawContextLength
      ? Number.parseInt(rawContextLength, 10)
      : 128_000
    if (Number.isNaN(contextLength) || contextLength <= 0) continue

    const description = parts[2]?.trim() || modelId

    entries.push({
      id: modelId,
      description,
      contextLength,
      providers: [provider],
    })
  }

  return entries
}

/**
 * Combined model registry: built-in `MODEL_REGISTRY` entries merged with any
 * extras from `LLM_EXTRA_MODELS`. Deduped by `provider:id`; registry entries
 * win over extras when both share the same key.
 */
export function getModelRegistry(): ModelEntry[] {
  const seen = new Set<string>()
  const result: ModelEntry[] = []

  for (const entry of MODEL_REGISTRY) {
    for (const provider of entry.providers) {
      seen.add(`${provider}:${entry.id}`)
    }
    result.push(entry)
  }

  for (const extra of parseExtraModels()) {
    const key = `${extra.providers[0]}:${extra.id}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(extra)
    }
  }

  return result
}

export function getAllModelOptions(): string[] {
  return MODEL_REGISTRY.flatMap((m) => m.providers.map((p) => `${p}:${m.id}`))
}

export function isFreeAgentModel(model: string): boolean {
  return model === 'openrouter/free' || model.endsWith(':free')
}
