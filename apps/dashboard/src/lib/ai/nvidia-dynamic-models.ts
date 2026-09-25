/**
 * NVIDIA NIM dynamic catalog + curated ranking for the agent model picker.
 *
 * Third provider to get discovery, closing the parity gap: OpenRouter and
 * AnyRouter both had a loader, so a deployment configured with only
 * `NVIDIA_API_KEY` used to see exactly the one hardcoded NVIDIA entry.
 *
 * ## API contract (verified against integrate.api.nvidia.com, 2026-09-26)
 *
 * - `GET {NVIDIA_API_BASE}/models` (default
 *   `https://integrate.api.nvidia.com/v1/models`) is **public** — it returns a
 *   full ~80-model catalog with no API key. Shape is the OpenAI-style list:
 *   `{ object: "list", data: [{ id, object, created, owned_by }] }`.
 * - The catalog is **much thinner than OpenRouter's** and every missing field
 *   shapes this module:
 *   - **No `context_length` / `max_model_len`** — context size is unknown, so
 *     dynamic entries fall back to a documented default. Only the curated
 *     registry knows a real context length.
 *   - **No `pricing`** — NVIDIA bills against API credits, not per-token, so
 *     dynamic entries carry no pricing (the picker omits cost rather than
 *     guessing).
 *   - **No `supported_parameters`** — NVIDIA publishes **no tool-capability
 *     metadata**, so unlike {@link ./openrouter-dynamic-models} we CANNOT
 *     filter on tool support.
 *   - **No `architecture`** — modality is unknown.
 *   - **`created` is a constant `735790403` (2001-01-01) for every entry**, so
 *     it carries no recency signal and must not be used for ranking.
 * - The catalog therefore mixes genuinely unusable entries (embedding models,
 *   safety guards, CLIP/VLM encoders, reward models, base completion models)
 *   with strong chat models. Since there is no capability field to filter on,
 *   {@link NVIDIA_EXCLUDED_PATTERNS} drops the provably-non-chat categories and
 *   {@link rankNvidiaModels} ranks what remains by documented heuristics.
 *
 * As with the other loaders, a successful catalog fetch does NOT imply NVIDIA is
 * configured — {@link isNvidiaDynamicEnabled} is the only authority on whether
 * dynamic entries may be surfaced. Discovery is **fail-soft** (`[]` on any
 * error) and **floor-preserving** (see {@link mergeNvidiaDynamicModels}), so
 * an NVIDIA outage degrades to the curated registry rather than an empty
 * picker.
 */

import type { AgentModelListEntry } from './anyrouter-dynamic-models'

import { MODEL_REGISTRY } from './agent-model-registry'
import { isProviderConfigured, PROVIDERS } from './providers'
import { formatCompactNumber } from '@/lib/format-number'

// ── Types (NVIDIA NIM public catalog shape) ──────────────────────────────────

/** Subset of `GET {NVIDIA_API_BASE}/models` list items we actually read. */
export interface NvidiaCatalogModel {
  id: string
  object?: string
  /** Constant on the live catalog — present only for shape tolerance. */
  created?: number
  owned_by?: string
  /** Some deployments proxy a richer OpenAI-compatible catalog. */
  context_length?: number
  pricing?: { prompt?: string | number; completion?: string | number }
  supported_parameters?: string[]
}

/** Ranked candidate ready to merge into the agent models list. */
export interface RankedNvidiaModel {
  modelId: string
  /** Full agent id `nvidia:{modelId}` */
  id: string
  name: string
  contextLength: number
  isFree: boolean
  /** Always false — NVIDIA publishes no tool-capability metadata. */
  supportsTools: boolean
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  /** Curated relevance score used for ordering. */
  score: number
}

// ── Constants ────────────────────────────────────────────────────────────────

/** In-memory cache TTL for the catalog + ranked result (ms). */
export const NVIDIA_DYNAMIC_CACHE_TTL_MS = 300_000

/** Default number of ranked models to merge into the picker. */
export const DEFAULT_NVIDIA_TOP_N = 8

/**
 * Context length assumed for a dynamic entry. The catalog publishes none, so
 * this is a documented floor, not a measured value — the curated registry
 * always wins over it (see {@link mergeNvidiaDynamicModels}).
 */
export const NVIDIA_DEFAULT_CONTEXT_LENGTH = 128_000

/**
 * Category patterns for entries that provably cannot drive the agent tool loop.
 *
 * This is an **exclusion** list, not an inclusion list, precisely because the
 * catalog carries no capability metadata. Every pattern is anchored on a
 * category marker in the model id (`embed`, `nemoguard`, `reward`, …) so an
 * unrelated future model is not silently dropped; the audited set below is
 * drawn from the live 2026-09-26 catalog.
 *
 * Adding a pattern means removing a model from discovery. If a pattern starts
 * matching a chat model, drop the pattern rather than special-casing the id.
 */
export const NVIDIA_EXCLUDED_PATTERNS: readonly RegExp[] = [
  /embed/i, // nvidia/embed-qa-4, nv-embedqa-*, arctic-embed-l, nemoretriever
  /nemoguard|guard|safety/i, // content-safety / topic-control guardrails
  /nemotron-parse|parsing/i, // record parser, not a chat model
  /-reward$/, // nemotron-4-340b-reward (RL scorer, no chat template)
  /deplot|diffusion|video|nvclip|vision-encoder/i, // chart-to-table, image/video encoders
  /codellama|starcoder/i, // base fill-in-the-middle code models (no chat template)
]

/**
 * Id fragments that indicate a chat/instruct/reasoning model — the closest
 * available proxy for "can hold an agent tool loop", used as a ranking bonus
 * rather than a filter so a strong model with an unusual name still surfaces.
 */
export const NVIDIA_AGENTIC_ID_HINTS: readonly RegExp[] = [
  /instruct/i,
  /-it\b|-it-/i,
  /chat/i,
  /reason/i,
  /nemotron/i,
  /thinking/i,
]

/**
 * Authors whose NVIDIA catalog entries are predominantly agent-grade chat
 * models. A bonus, not a filter.
 */
export const NVIDIA_PREFERRED_AUTHORS = [
  'nvidia',
  'qwen',
  'moonshotai',
  'z-ai',
  'deepseek-ai',
  'openai',
  'mistralai',
  'nv-mistralai',
  'google',
  'meta',
  'microsoft',
] as const

// Scoring weights — documented so the ranking stays auditable.
const SCORE_CURATED_REGISTRY_BONUS = 1000
const SCORE_AGENTIC_ID_BONUS = 200
const SCORE_PREFERRED_AUTHOR_BONUS = 100
/** Multiplier applied to log2(context_length) when the catalog supplies one. */
const SCORE_CONTEXT_LENGTH_LOG_WEIGHT = 5

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** The set of upstream NVIDIA model ids present in the curated registry. */
const CURATED_NVIDIA_MODEL_IDS = new Set(
  MODEL_REGISTRY.filter((entry) => entry.providers.includes('nvidia')).map(
    (entry) => entry.id
  )
)

/** True when the id matches a provably non-agent category. */
export function isExcludedNvidiaModel(modelId: string): boolean {
  return NVIDIA_EXCLUDED_PATTERNS.some((re) => re.test(modelId))
}

/** True when the id carries a chat/instruct/reasoning marker. */
export function hasAgenticNvidiaHint(modelId: string): boolean {
  return NVIDIA_AGENTIC_ID_HINTS.some((re) => re.test(modelId))
}

function authorOf(modelId: string): string | null {
  const slash = modelId.indexOf('/')
  if (slash <= 0) return null
  return modelId.slice(0, slash)
}

function contextLengthOf(model: NvidiaCatalogModel): number {
  const raw = model.context_length
  return typeof raw === 'number' && raw > 0
    ? raw
    : NVIDIA_DEFAULT_CONTEXT_LENGTH
}

/**
 * NVIDIA bills against credits, not per-token, so the real catalog reports no
 * rate and the picker omits cost. A self-hosted/proxying catalog that speaks
 * the OpenRouter shape does report **per-token** prices, so convert to
 * per-million to match `ModelEntry.pricing` (same as
 * {@link ./openrouter-dynamic-models}). A zero rate is treated as "not
 * reported" rather than "free", since free is expressed by
 * `isFreeAgentModel` on the id.
 */
function parsePricePerMillion(
  model: NvidiaCatalogModel
): { inputPerMillion: number; outputPerMillion: number } | undefined {
  if (!model.pricing) return undefined
  const prompt = Number(model.pricing.prompt)
  const completion = Number(model.pricing.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined
  if (prompt === 0 && completion === 0) return undefined
  return {
    inputPerMillion: prompt * 1_000_000,
    outputPerMillion: completion * 1_000_000,
  }
}

export interface RankNvidiaOptions {
  limit?: number
}

/**
 * Rank NVIDIA catalog models by a deterministic **curated relevance** score.
 *
 * The catalog exposes no usage, recency (`created` is constant), or capability
 * signal, so the score is: curated-registry presence, an agentic id marker, a
 * preferred author, and context size when a proxy reports it. Ties break by
 * `id` ascending so output is stable across calls.
 */
export function rankNvidiaModels(
  catalog: readonly NvidiaCatalogModel[],
  opts: RankNvidiaOptions = {}
): RankedNvidiaModel[] {
  const scored = catalog
    .filter((m) => m.id && !isExcludedNvidiaModel(m.id))
    .map((model) => {
      let score = 0
      if (CURATED_NVIDIA_MODEL_IDS.has(model.id)) {
        score += SCORE_CURATED_REGISTRY_BONUS
      }
      if (hasAgenticNvidiaHint(model.id)) {
        score += SCORE_AGENTIC_ID_BONUS
      }
      const author = authorOf(model.id)
      if (
        author &&
        (NVIDIA_PREFERRED_AUTHORS as readonly string[]).includes(author)
      ) {
        score += SCORE_PREFERRED_AUTHOR_BONUS
      }
      if (
        typeof model.context_length === 'number' &&
        model.context_length > 0
      ) {
        score +=
          Math.log2(model.context_length) * SCORE_CONTEXT_LENGTH_LOG_WEIGHT
      }
      return { model, score }
    })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0
  })

  const limit = opts.limit ?? scored.length
  return scored
    .slice(0, limit)
    .map(({ model, score }) => toRanked(model, score))
}

function toRanked(model: NvidiaCatalogModel, score: number): RankedNvidiaModel {
  const pricing = parsePricePerMillion(model)
  return {
    modelId: model.id,
    id: `nvidia:${model.id}`,
    name: model.id,
    contextLength: contextLengthOf(model),
    isFree: true, // credit-billed, no published per-token rate
    supportsTools: false, // unknown, not verified
    ...(pricing ? { pricing } : {}),
    score,
  }
}

function rankedToAgentModelEntry(
  ranked: RankedNvidiaModel
): AgentModelListEntry {
  return {
    id: ranked.id,
    modelId: ranked.modelId,
    provider: 'nvidia',
    name: ranked.name,
    // The catalog carries no description; the id is the label.
    description: '',
    contextLength: ranked.contextLength,
    formattedContextLength: formatCompactNumber(ranked.contextLength),
    isFree: ranked.isFree,
    available: isProviderConfigured('nvidia'),
    ...(ranked.pricing ? { pricing: ranked.pricing } : {}),
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

/** Resolve the NVIDIA models endpoint from the configured base URL. */
export function nvidiaModelsUrl(): string {
  const base =
    process.env.NVIDIA_API_BASE ||
    PROVIDERS.nvidia?.baseURL ||
    'https://integrate.api.nvidia.com/v1'
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}/models`
}

/**
 * Whether dynamic NVIDIA enrichment should run.
 * Fail-closed: requires the NVIDIA provider configured (API key present) — the
 * catalog endpoint itself is public and does NOT imply configuration.
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
 * Fetch the NVIDIA NIM models catalog. Fail-soft to `[]` on any error or
 * non-ok response — a provider outage must never empty the picker.
 */
export async function fetchNvidiaCatalog(
  fetchImpl: typeof fetch = fetch
): Promise<NvidiaCatalogModel[]> {
  const url = process.env.NVIDIA_MODELS_API || nvidiaModelsUrl()
  // Sent only when present, so a self-hosted NIM behind NVIDIA_API_BASE that
  // requires auth works, while the public endpoint is still reachable.
  const apiKey = process.env.NVIDIA_API_KEY?.trim()
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: NvidiaCatalogModel[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return []
  }
}

export interface BuildNvidiaDynamicOptions {
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
  options: BuildNvidiaDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const topN = options.topN ?? getTopN()
  const now = Date.now()

  if (!options.forceRefresh && catalogCache && catalogCache.expiresAt > now) {
    const ranked = rankNvidiaModels(catalogCache.value, { limit: topN })
    return ranked.map(rankedToAgentModelEntry)
  }

  const catalog = await fetchNvidiaCatalog(fetchImpl)
  catalogCache = {
    value: catalog,
    expiresAt: now + NVIDIA_DYNAMIC_CACHE_TTL_MS,
  }

  const ranked = rankNvidiaModels(catalog, { limit: topN })
  return ranked.map(rankedToAgentModelEntry)
}

/**
 * Fail-soft cached helper for the models endpoint: returns `[]` when disabled
 * or on any failure, honouring the TTL cache. Mirrors
 * `loadOpenRouterDynamicModelEntries`.
 */
export async function loadNvidiaDynamicModelEntries(
  options: BuildNvidiaDynamicOptions = {}
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
