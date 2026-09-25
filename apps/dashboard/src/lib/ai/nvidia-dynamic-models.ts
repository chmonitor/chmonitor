/**
 * NVIDIA NIM dynamic catalog for the agent model picker.
 *
 * ## API contract (verified against integrate.api.nvidia.com, 2026-09-26)
 *
 * - `GET {NVIDIA_API_BASE}/models` (default
 *   `https://integrate.api.nvidia.com/v1/models`) is **public** (no API key
 *   required) and returns `{ object: 'list', data: NvidiaCatalogModel[] }`
 *   with 82 hosted models. Every item carries ONLY `id`, `object`, `created`
 *   and `owned_by`.
 * - **The catalog is much thinner than OpenRouter's and AnyRouter's.** It
 *   exposes no `pricing`, no `context_length`, and no capability/tooling
 *   flags, so this module cannot derive cost, context size, or tool support
 *   from it. Consequences, all deliberate:
 *   - `pricing` is always omitted — the picker shows no cost for an
 *     own-key NIM model instead of guessing a number. (The deployment pays
 *     NVIDIA directly, so the dashboard has no per-token rate to report.)
 *   - `contextLength` falls back to a single documented default
 *     ({@link DEFAULT_NVIDIA_CONTEXT_LENGTH}) rather than a per-model claim.
 *   - Tool capability cannot be read, so eligibility comes from the curated
 *     allowlist {@link NVIDIA_TOOL_CAPABLE_MODEL_IDS} — the same shape of
 *     curated signal as OpenRouter's {@link OPENROUTER_PREFERRED_AUTHORS},
 *     and every id in it is verified present in the live catalog.
 * - `created` is the constant `735790403` on all 82 models (a placeholder,
 *   not a real timestamp), so this module deliberately has **no** recency
 *   term — scoring it would be a fake signal, unlike OpenRouter's ranking
 *   which uses genuinely distinct `created` values.
 *
 * The model *id* is the only field taken from the catalog; the curated floor in
 * `agent-model-registry.ts` remains the authority for descriptions and context
 * sizes of models it lists.
 *
 * Fetching the catalog succeeding does NOT imply the NVIDIA provider is
 * configured (the endpoint is public even without a key) — the enable gate
 * ({@link isNvidiaDynamicEnabled}) is the only authority on whether dynamic
 * entries should be surfaced, mirroring the OpenRouter and AnyRouter modules.
 */

import type { AgentModelListEntry } from './anyrouter-dynamic-models'

import { MODEL_REGISTRY } from './agent-model-registry'
import { isProviderConfigured } from './providers'
import { formatCompactNumber } from '@/lib/format-number'

// ── Types (NVIDIA NIM public catalog shape) ──────────────────────────────────

/**
 * Subset of `GET /models` list items we actually read. The upstream response
 * carries no capability or pricing fields at all — see the module header.
 */
export interface NvidiaCatalogModel {
  id: string
  object?: string
  /** Placeholder on every item (constant upstream) — never used for scoring. */
  created?: number
  /** Model publisher, e.g. `nvidia`, `google`, `meta`. */
  owned_by?: string
}

/** Candidate ready to merge into the agent models list. */
export interface RankedNvidiaModel {
  modelId: string
  /** Full agent id `nvidia:{modelId}` */
  id: string
  name: string
  description: string
  contextLength: number
  supportsTools: boolean
  /** Position in {@link NVIDIA_TOOL_CAPABLE_MODEL_IDS} (lower is stronger). */
  tier: number
}

// ── Constants ────────────────────────────────────────────────────────────────

/** In-memory cache TTL for the catalog + ranked result (ms). */
export const NVIDIA_DYNAMIC_CACHE_TTL_MS = 300_000

/** Default number of ranked models to merge into the picker. */
export const DEFAULT_NVIDIA_TOP_N = 12

/**
 * Context window reported for catalog models. The NIM catalog publishes no
 * context length, so every dynamic entry reports this documented default
 * rather than a per-model figure we cannot verify. Curated entries in
 * `MODEL_REGISTRY` keep their own, verified values.
 */
export const DEFAULT_NVIDIA_CONTEXT_LENGTH = 128_000

/**
 * NIM-hosted models verified to drive the agent tool loop, strongest first.
 *
 * The catalog carries no tooling flag, so this allowlist is the eligibility
 * gate (mirroring `OPENROUTER_PREFERRED_AUTHORS`). Every id below was
 * confirmed present in `GET /models` on 2026-09-26; tool support was
 * cross-checked on the providers that do publish capability flags —
 * OpenRouter's `supported_parameters` and/or AnyRouter's `capabilities` —
 * except for the Nemotron 70B entry, which the curated registry already ships.
 * Models with no such evidence (e.g. `mistralai/mistral-large-2-instruct`,
 * `nvidia/nemotron-parse-2.0`, `z-ai/glm-5.3`) are deliberately excluded.
 */
export const NVIDIA_TOOL_CAPABLE_MODEL_IDS = [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'deepseek-ai/deepseek-v4.1-flash',
  'moonshotai/kimi-k3',
  'moonshotai/kimi-k2.6',
  'z-ai/glm-5.3-flash',
  'google/gemma-4-31b-it',
  'openai/gpt-oss-20b',
  'nvidia/llama-3.1-nemotron-70b-instruct',
] as const

/** Set form of {@link NVIDIA_TOOL_CAPABLE_MODEL_IDS} for membership checks. */
const TOOL_CAPABLE_IDS = new Set<string>(NVIDIA_TOOL_CAPABLE_MODEL_IDS)

/** The set of curated registry ids that are also NIM-hosted. */
const CURATED_NVIDIA_MODEL_IDS = new Set(
  MODEL_REGISTRY.filter((entry) => entry.providers.includes('nvidia')).map(
    (entry) => entry.id
  )
)

/** Curated description for an id, when the registry already describes it. */
const CURATED_NVIDIA_DESCRIPTIONS = new Map(
  MODEL_REGISTRY.filter((entry) => entry.providers.includes('nvidia')).map(
    (entry) => [entry.id, entry.description]
  )
)

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Whether a catalog model is allowed to surface in the picker. */
export function isNvidiaToolCapable(model: NvidiaCatalogModel): boolean {
  return TOOL_CAPABLE_IDS.has(model.id)
}

/**
 * Curated context length for an NIM model id, or the documented default.
 * Only the curated registry has verified values, so nothing else is claimed.
 */
function contextLengthFor(modelId: string): number {
  const curated = MODEL_REGISTRY.find(
    (entry) => entry.id === modelId && entry.providers.includes('nvidia')
  )
  return curated?.contextLength ?? DEFAULT_NVIDIA_CONTEXT_LENGTH
}

export interface RankNvidiaOptions {
  limit?: number
}

/**
 * Select the tool-capable NIM models present in the catalog, strongest first.
 *
 * Ranking is deliberately simple and fully auditable: curated-registry
 * entries first, then allowlist order (strongest first). Ties break on `id`
 * so the output is stable across calls. There is no recency or context term —
 * the catalog publishes neither (see module header).
 */
export function rankNvidiaModels(
  catalog: readonly NvidiaCatalogModel[],
  opts: RankNvidiaOptions = {}
): RankedNvidiaModel[] {
  const eligible = catalog.filter((m) => m.id && isNvidiaToolCapable(m))

  const scored = eligible.map((model) => {
    const tier = NVIDIA_TOOL_CAPABLE_MODEL_IDS.indexOf(
      model.id as (typeof NVIDIA_TOOL_CAPABLE_MODEL_IDS)[number]
    )
    return {
      model,
      score: CURATED_NVIDIA_MODEL_IDS.has(model.id) ? 1 : 0,
      tier,
    }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0
  })

  const limit = opts.limit ?? scored.length
  return scored.slice(0, limit).map(({ model, tier }) => ({
    modelId: model.id,
    id: `nvidia:${model.id}`,
    name: model.id,
    description: CURATED_NVIDIA_DESCRIPTIONS.get(model.id) ?? model.id,
    contextLength: contextLengthFor(model.id),
    supportsTools: true,
    tier,
  }))
}

function rankedToAgentModelEntry(
  ranked: RankedNvidiaModel
): AgentModelListEntry {
  return {
    id: ranked.id,
    modelId: ranked.modelId,
    provider: 'nvidia',
    name: ranked.name,
    description: ranked.description,
    contextLength: ranked.contextLength,
    formattedContextLength: formatCompactNumber(ranked.contextLength),
    // No pricing: the NIM catalog publishes no rates and the deployment bills
    // NVIDIA directly. Omitted rather than guessed — see module header.
    isFree: false,
    available: isProviderConfigured('nvidia'),
    supportsTools: ranked.supportsTools,
    supportsStreaming: true,
    dynamic: true,
  }
}

/**
 * Merge dynamic NVIDIA entries with the static/registry list.
 *
 * Win rules (mirrors `mergeOpenRouterDynamicModels`):
 * - Curated `base` entries always win and are never dropped (must-have floor).
 * - Dynamic entries not already present (by `id`) are appended.
 */
export function mergeNvidiaDynamicModels<T extends { id: string }>(
  base: readonly T[],
  dynamic: readonly T[]
): T[] {
  const seen = new Set(base.map((m) => m.id))
  const extras = dynamic.filter((m) => !seen.has(m.id))
  return [...base, ...extras]
}

// ── I/O + cache ──────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

let catalogCache: CacheEntry<NvidiaCatalogModel[]> | null = null
let entriesCache: CacheEntry<AgentModelListEntry[]> | null = null

/** Test-only: clear in-memory caches. */
export function __resetNvidiaDynamicCachesForTests(): void {
  catalogCache = null
  entriesCache = null
}

/**
 * Whether dynamic NVIDIA enrichment should run.
 * Fail-closed: requires the NVIDIA provider configured (API key present) —
 * the catalog endpoint itself is public and does NOT imply configuration.
 * Optional kill-switch: NVIDIA_DYNAMIC_MODELS=false|0|off|no.
 */
export function isNvidiaDynamicEnabled(): boolean {
  const flag = process.env.NVIDIA_DYNAMIC_MODELS?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') {
    return false
  }
  return isProviderConfigured('nvidia')
}

function getTopN(): number {
  const raw = process.env.NVIDIA_TOP_MODELS_N?.trim()
  if (!raw) return DEFAULT_NVIDIA_TOP_N
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_NVIDIA_TOP_N
  return Math.min(Math.max(n, 1), 32)
}

/**
 * Fetch the public NVIDIA NIM models catalog. Fail-soft to `[]` on any error
 * or non-ok response — a provider outage must never empty the picker.
 */
export async function fetchNvidiaCatalog(
  fetchImpl: typeof fetch = fetch
): Promise<NvidiaCatalogModel[]> {
  const base = (
    process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1'
  ).replace(/\/+$/, '')
  try {
    const response = await fetchImpl(`${base}/models`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: NvidiaCatalogModel[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return []
  }
}

export interface BuildDynamicOptions {
  fetchImpl?: typeof fetch
  topN?: number
  /** Skip cache (tests). */
  forceRefresh?: boolean
}

/**
 * Fetch + rank + take the top N NVIDIA models, mapped to
 * `AgentModelListEntry`. Fail-soft: returns `[]` on any error.
 */
export async function buildNvidiaDynamicModels(
  options: BuildDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const topN = options.topN ?? getTopN()
  const now = Date.now()

  if (!options.forceRefresh && catalogCache && catalogCache.expiresAt > now) {
    return rankNvidiaModels(catalogCache.value, { limit: topN }).map(
      rankedToAgentModelEntry
    )
  }

  const catalog = await fetchNvidiaCatalog(fetchImpl)
  catalogCache = {
    value: catalog,
    expiresAt: now + NVIDIA_DYNAMIC_CACHE_TTL_MS,
  }

  return rankNvidiaModels(catalog, { limit: topN }).map(
    rankedToAgentModelEntry
  )
}

/**
 * Fail-soft cached helper for the models endpoint: returns `[]` when disabled
 * or on any failure, honouring the TTL cache. Mirrors
 * `loadOpenRouterDynamicModelEntries`.
 */
export async function loadNvidiaDynamicModelEntries(
  options: BuildDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  if (!isNvidiaDynamicEnabled() && !options.fetchImpl) return []
  const now = Date.now()
  if (!options.forceRefresh && entriesCache && entriesCache.expiresAt > now) {
    return entriesCache.value
  }
  try {
    const entries = await buildNvidiaDynamicModels(options)
    entriesCache = {
      value: entries,
      expiresAt: now + NVIDIA_DYNAMIC_CACHE_TTL_MS,
    }
    return entries
  } catch (error) {
    console.warn(
      '[Agent] NVIDIA dynamic models unavailable:',
      error instanceof Error ? error.message : error
    )
    return []
  }
}
