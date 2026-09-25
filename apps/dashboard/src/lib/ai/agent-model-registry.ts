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

/**
 * The curated floor: models guaranteed to be offered whenever their provider
 * is configured, regardless of what discovery returns. Every merge helper
 * keeps its `base`, so an upstream outage degrades to this list rather than an
 * empty picker.
 *
 * Refreshed 2026-09-26. Context lengths and per-million prices below were read
 * from OpenRouter's public catalog (`GET /api/v1/models`) on that date, not
 * hand-recalled; NVIDIA-only entries use the context length published for the
 * same family because NVIDIA's own catalog carries none. Entries with no
 * `pricing` have **no published fixed per-token rate** (credit-billed, or a
 * router whose rate follows the model it picks) — the picker omits cost rather
 * than showing a wrong `$0`, and `MODEL_PRICING` records that as an explicit
 * unknown instead of a zero. `MODEL_REGISTRY` / `MODEL_PRICING` / the picker
 * are asserted consistent by `__tests__/model-registry-consistency.test.ts`.
 */
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
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    providers: ['openrouter'],
  },
  {
    id: 'openrouter/auto',
    description: 'Auto-router: best available (paid)',
    contextLength: 2_000_000,
    providers: ['openrouter'],
  },

  // ── Free tier (verified $0, tool-capable) ──
  {
    id: 'google/gemma-4-31b-it:free',
    description: 'Gemma 4 31B IT (free tier)',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    providers: ['openrouter'],
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    description: 'Gemma 4 26B IT (free tier)',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    providers: ['openrouter', 'anyrouter'],
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    description: 'Nemotron 3 Super 120B (free tier)',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    providers: ['openrouter'],
  },
  {
    id: 'qwen/qwen3.8-27b:free',
    description: 'Qwen 3.8 27B (free tier)',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    providers: ['openrouter'],
  },

  // ── Frontier (paid, multi-provider) ──
  {
    id: 'anthropic/claude-opus-5.5',
    description: 'Claude Opus 5.5',
    contextLength: 1_000_000,
    pricing: { inputPerMillion: 4, outputPerMillion: 20 },
    providers: ['openrouter'],
  },
  {
    id: 'openai/gpt-6-sol',
    description: 'GPT-6 Sol',
    contextLength: 1_050_000,
    pricing: { inputPerMillion: 2, outputPerMillion: 10 },
    providers: ['openrouter'],
  },
  {
    id: 'x-ai/grok-4.7',
    description: 'Grok 4.7',
    contextLength: 500_000,
    pricing: { inputPerMillion: 1.6, outputPerMillion: 4.8 },
    providers: ['openrouter', 'anyrouter'],
  },
  {
    id: 'z-ai/glm-5.3',
    description: 'GLM 5.3',
    contextLength: 1_310_720,
    pricing: { inputPerMillion: 1.4, outputPerMillion: 4.4 },
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },
  {
    id: 'moonshotai/kimi-k3',
    description: 'Kimi K3',
    contextLength: 1_048_576,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    providers: ['openrouter', 'anyrouter'],
  },

  // ── Value picks: long context at a low rate ──
  {
    id: 'openai/gpt-6-luna',
    description: 'GPT-6 Luna, 1M context',
    contextLength: 1_050_000,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5 },
    providers: ['openrouter'],
  },
  {
    id: 'z-ai/glm-5.3-flash',
    description: 'GLM 5.3 Flash, 1M context',
    contextLength: 1_310_720,
    pricing: { inputPerMillion: 0.045, outputPerMillion: 0.14 },
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    description: 'DeepSeek V4.1 Flash, 1M context',
    contextLength: 1_048_576,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    providers: ['openrouter'],
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    description: 'Gemini 3.1 Flash Lite',
    contextLength: 1_048_576,
    pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
    providers: ['openrouter', 'anyrouter'],
  },
  {
    id: 'qwen/qwen3.5-397b-a17b',
    description: 'Qwen 3.5 397B MoE',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 3.5 },
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },

  // ── Small / cheap tool-capable ──
  {
    id: 'openai/gpt-oss-120b',
    description: 'GPT-OSS 120B',
    contextLength: 131_072,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    providers: ['openrouter', 'nvidia'],
  },
  {
    id: 'openai/gpt-oss-20b',
    description: 'GPT-OSS 20B, cheapest tool-capable',
    contextLength: 131_072,
    pricing: { inputPerMillion: 0.018, outputPerMillion: 0.09 },
    providers: ['openrouter'],
  },
  {
    id: 'google/gemma-4-26b-a4b-it',
    description: 'Gemma 4 26B IT',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0.0675, outputPerMillion: 0.225 },
    providers: ['openrouter', 'anyrouter'],
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    description: 'Nemotron 3 Ultra 550B',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0.6, outputPerMillion: 2.4 },
    providers: ['openrouter', 'nvidia', 'anyrouter'],
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    description: 'Nemotron 3 Super 120B',
    contextLength: 262_144,
    pricing: { inputPerMillion: 0.08, outputPerMillion: 0.45 },
    providers: ['openrouter', 'nvidia'],
  },

  // ── NVIDIA-only ──
  // Context lengths are the curated floor: NVIDIA's catalog publishes none, so
  // these are the values published for the same Nemotron family. Per-token
  // pricing is omitted because NVIDIA bills against API credits.
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    description: 'Nemotron 70B Instruct',
    contextLength: 131_072,
    providers: ['nvidia'],
  },
  {
    id: 'nvidia/llama-3.1-nemotron-51b-instruct',
    description: 'Nemotron 51B Instruct',
    contextLength: 131_072,
    providers: ['nvidia'],
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    description: 'Nemotron Ultra 253B',
    contextLength: 131_072,
    providers: ['nvidia'],
  },
  {
    id: 'nvidia/nemotron-4-340b-instruct',
    description: 'Nemotron 4 340B Instruct',
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

/**
 * The curated `provider:id` options, as a set — the picker uses it to mark an
 * entry "built in" versus a discovery-supplied one. It lives here rather than
 * in the picker component because it is a pure derivation of
 * {@link getAllModelOptions}: keeping it in the component made the registry
 * depend on the component's own import graph (`picker → use-agent-model →
 * registry`), which is a cycle.
 */
export const CURATED_MODEL_IDS: ReadonlySet<string> = new Set(
  getAllModelOptions()
)

export function isFreeAgentModel(model: string): boolean {
  return model === 'openrouter/free' || model.endsWith(':free')
}
