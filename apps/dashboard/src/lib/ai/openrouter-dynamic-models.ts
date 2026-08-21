/**
 * OpenRouter dynamic catalog + curated ranking for the agent model picker.
 *
 * ## API contract (verified against openrouter.ai, 2026-08-13)
 *
 * - `GET https://openrouter.ai/api/v1/models` is **public** (no API key
 *   required) and returns `{ data: OpenRouterCatalogModel[] }` with ~410
 *   models. Fields we read: `id`, `name`, `description`, `created` (unix
 *   seconds), `context_length`, `architecture.{modality,input_modalities,
 *   output_modalities}`, `pricing.{prompt,completion}`, `top_provider.
 *   {context_length,max_completion_tokens}`, `supported_parameters`
 *   (contains `tools`/`tool_choice` when the model is tool-capable).
 * - **`pricing.prompt` / `pricing.completion` are USD PER TOKEN, not per
 *   million** — the opposite convention from AnyRouter
 *   ({@link ./anyrouter-dynamic-models}). We multiply by `1_000_000` to match
 *   `MODEL_REGISTRY.pricing`'s per-million convention (see
 *   `agent-model-registry.ts`'s `ModelEntry.pricing` doc comment).
 * - **The `order` query param is ignored by the API** — `?order=top-weekly`,
 *   `?order=created`, `?order=name` all return the identical list order.
 *   There is no public usage-ranking endpoint (`/api/frontend/*` returns
 *   HTML; `/api/v1/models/user` requires a user token and 401s for a plain
 *   API key). So this module does NOT claim to rank by real usage — it ranks
 *   by a documented, deterministic **curated relevance** score (registry
 *   presence, known frontier authors, free tier, context size, recency).
 *
 * Fetching the catalog succeeding does NOT imply the OpenRouter provider is
 * configured (the catalog endpoint is public even without a key) — the
 * enable gate ({@link isOpenRouterDynamicEnabled}) is the only authority on
 * whether dynamic entries should be surfaced, mirroring AnyRouter's module.
 */

import type { AgentModelListEntry } from './anyrouter-dynamic-models'

import { MODEL_REGISTRY } from './agent-model-registry'
import { isProviderConfigured } from './providers'
import { formatCompactNumber } from '@/lib/format-number'

// ── Types (OpenRouter public catalog shape) ──────────────────────────────────

/** Subset of `GET /api/v1/models` list items we actually read. */
export interface OpenRouterCatalogModel {
  id: string
  canonical_slug?: string
  name?: string
  description?: string
  /** Unix seconds. */
  created?: number
  context_length?: number
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
  /** USD **per token** (not per million) — see module header. */
  pricing?: {
    prompt?: string | number
    completion?: string | number
  }
  top_provider?: {
    context_length?: number | null
    max_completion_tokens?: number | null
  }
  supported_parameters?: string[]
}

/** Ranked candidate ready to merge into the agent models list. */
export interface RankedOpenRouterModel {
  modelId: string
  /** Full agent id `openrouter:{modelId}` */
  id: string
  name: string
  description: string
  contextLength: number
  maxOutputTokens?: number
  isFree: boolean
  supportsTools: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  /** Curated relevance score used for ordering (not usage-derived). */
  score: number
}

// ── Constants ────────────────────────────────────────────────────────────────

/** In-memory cache TTL for the catalog + ranked result (ms). */
export const OPENROUTER_DYNAMIC_CACHE_TTL_MS = 300_000

/** Default number of ranked models to merge into the picker. */
export const DEFAULT_OPENROUTER_TOP_N = 12

/**
 * Well-known frontier model authors (OpenRouter id prefix before `/`) that
 * receive a relevance bonus in {@link rankOpenRouterModels}. Chosen to match
 * the vendors already represented in the curated `MODEL_REGISTRY`.
 */
export const OPENROUTER_PREFERRED_AUTHORS = [
  'anthropic',
  'openai',
  'google',
  'x-ai',
  'qwen',
  'deepseek',
  'moonshotai',
  'z-ai',
  'mistralai',
] as const

// Scoring weights — documented so the ranking stays auditable. Larger =
// stronger signal. These are curated-relevance weights, not measured usage.
const SCORE_CURATED_REGISTRY_BONUS = 1000
const SCORE_PREFERRED_AUTHOR_BONUS = 200
const SCORE_FREE_VARIANT_BONUS = 50
/** Multiplier applied to log2(context_length) (context grows on a log scale). */
const SCORE_CONTEXT_LENGTH_LOG_WEIGHT = 5
/** Multiplier applied to age-decay recency signal in [0, 1]. */
const SCORE_RECENCY_WEIGHT = 30
/** Recency window: models older than this contribute ~0 recency score. */
const RECENCY_HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000 // ~180 days

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** The set of upstream OpenRouter model ids present in the curated registry. */
const CURATED_OPENROUTER_MODEL_IDS = new Set(
  MODEL_REGISTRY.filter((entry) => entry.providers.includes('openrouter')).map(
    (entry) => entry.id
  )
)

/**
 * True when the model can drive the agent tool loop (OpenRouter surfaces
 * this via `supported_parameters`, unlike AnyRouter's `capabilities` field).
 */
export function isOpenRouterToolCapable(
  model: OpenRouterCatalogModel
): boolean {
  const params = model.supported_parameters ?? []
  return params.includes('tools') || params.includes('tool_choice')
}

function outputsText(model: OpenRouterCatalogModel): boolean {
  const outs = model.architecture?.output_modalities
  if (!outs || outs.length === 0) return true // unknown → assume text-capable
  return outs.includes('text')
}

function supportsVision(model: OpenRouterCatalogModel): boolean {
  const modalities = model.architecture?.input_modalities ?? []
  return modalities.some((m) => m.toLowerCase().includes('image'))
}

function readPricePerToken(
  pricing: OpenRouterCatalogModel['pricing']
): { prompt: number; completion: number } | null {
  if (!pricing) return null
  const prompt = Number(pricing.prompt)
  const completion = Number(pricing.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  return { prompt, completion }
}

function isFreeVariant(model: OpenRouterCatalogModel): boolean {
  if (model.id.endsWith(':free')) return true
  const pair = readPricePerToken(model.pricing)
  return pair !== null && pair.prompt === 0 && pair.completion === 0
}

/** Convert OpenRouter's per-token pricing to per-million, matching MODEL_REGISTRY. */
function parsePricePerMillion(
  pricing: OpenRouterCatalogModel['pricing']
): { inputPerMillion: number; outputPerMillion: number } | undefined {
  const pair = readPricePerToken(pricing)
  if (!pair) return undefined
  if (pair.prompt === 0 && pair.completion === 0) return undefined // free → omit
  return {
    inputPerMillion: pair.prompt * 1_000_000,
    outputPerMillion: pair.completion * 1_000_000,
  }
}

function preferredAuthorOf(modelId: string): string | null {
  const slash = modelId.indexOf('/')
  if (slash <= 0) return null
  return modelId.slice(0, slash)
}

export interface RankOpenRouterOptions {
  /** Deterministic "now" for the recency bonus (defaults to `Date.now()`). */
  now?: number
  limit?: number
}

/**
 * Rank tool-capable, text-output OpenRouter models by a deterministic
 * **curated relevance** score (NOT usage — OpenRouter exposes no public
 * usage-ranking signal, see module header). Ties break by `id` ascending so
 * output is stable across calls.
 */
export function rankOpenRouterModels(
  catalog: readonly OpenRouterCatalogModel[],
  opts: RankOpenRouterOptions = {}
): RankedOpenRouterModel[] {
  const now = opts.now ?? Date.now()

  const eligible = catalog.filter(
    (m) => m.id && outputsText(m) && isOpenRouterToolCapable(m)
  )

  const scored = eligible.map((model) => {
    let score = 0
    if (CURATED_OPENROUTER_MODEL_IDS.has(model.id)) {
      score += SCORE_CURATED_REGISTRY_BONUS
    }
    const author = preferredAuthorOf(model.id)
    if (
      author &&
      (OPENROUTER_PREFERRED_AUTHORS as readonly string[]).includes(author)
    ) {
      score += SCORE_PREFERRED_AUTHOR_BONUS
    }
    if (isFreeVariant(model)) {
      score += SCORE_FREE_VARIANT_BONUS
    }
    const contextLength = model.context_length ?? 0
    if (contextLength > 0) {
      score += Math.log2(contextLength) * SCORE_CONTEXT_LENGTH_LOG_WEIGHT
    }
    if (typeof model.created === 'number' && model.created > 0) {
      const ageMs = now - model.created * 1000
      const recency = ageMs <= 0 ? 1 : Math.exp(-ageMs / RECENCY_HALF_LIFE_MS)
      score += recency * SCORE_RECENCY_WEIGHT
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

function toRanked(
  model: OpenRouterCatalogModel,
  score: number
): RankedOpenRouterModel {
  const pricing = parsePricePerMillion(model.pricing)
  const maxOut = model.top_provider?.max_completion_tokens
  return {
    modelId: model.id,
    id: `openrouter:${model.id}`,
    name: model.id,
    description: model.description?.trim() ?? '',
    contextLength:
      model.context_length ?? model.top_provider?.context_length ?? 128_000,
    ...(typeof maxOut === 'number' && maxOut > 0
      ? { maxOutputTokens: maxOut }
      : {}),
    isFree: isFreeVariant(model),
    supportsTools: isOpenRouterToolCapable(model),
    supportsStreaming: outputsText(model),
    supportsVision: supportsVision(model),
    ...(pricing ? { pricing } : {}),
    score,
  }
}

function rankedToAgentModelEntry(
  ranked: RankedOpenRouterModel
): AgentModelListEntry {
  return {
    id: ranked.id,
    modelId: ranked.modelId,
    provider: 'openrouter',
    name: ranked.name,
    description: ranked.description,
    contextLength: ranked.contextLength,
    formattedContextLength: formatCompactNumber(ranked.contextLength),
    ...(ranked.maxOutputTokens
      ? {
          maxOutputTokens: ranked.maxOutputTokens,
          formattedMaxOutputTokens: formatCompactNumber(ranked.maxOutputTokens),
        }
      : {}),
    isFree: ranked.isFree,
    available: isProviderConfigured('openrouter'),
    ...(ranked.pricing ? { pricing: ranked.pricing } : {}),
    supportsTools: ranked.supportsTools,
    supportsStreaming: ranked.supportsStreaming,
    supportsVision: ranked.supportsVision,
    dynamic: true,
  }
}

/**
 * Merge dynamic OpenRouter entries with the static/registry list.
 *
 * Win rules (mirrors `mergeAnyRouterDynamicModels`):
 * - Curated `base` entries always win and are never dropped (must-have floor).
 * - Dynamic entries not already present (by `id`) are appended.
 */
export function mergeOpenRouterDynamicModels<T extends { id: string }>(
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

let catalogCache: CacheEntry<OpenRouterCatalogModel[]> | null = null
let entriesCache: CacheEntry<AgentModelListEntry[]> | null = null

/** Test-only: clear in-memory caches. */
export function __resetOpenRouterDynamicCachesForTests(): void {
  catalogCache = null
  entriesCache = null
}

/**
 * Whether dynamic OpenRouter enrichment should run.
 * Fail-closed: requires the OpenRouter provider configured (API key present) —
 * the catalog endpoint itself is public and does NOT imply configuration.
 * Optional kill-switch: OPENROUTER_DYNAMIC_MODELS=false|0|off|no.
 */
export function isOpenRouterDynamicEnabled(): boolean {
  const flag = process.env.OPENROUTER_DYNAMIC_MODELS?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') {
    return false
  }
  return isProviderConfigured('openrouter')
}

function getTopN(): number {
  const raw = process.env.OPENROUTER_TOP_MODELS_N?.trim()
  if (!raw) return DEFAULT_OPENROUTER_TOP_N
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OPENROUTER_TOP_N
  return Math.min(Math.max(n, 1), 32)
}

/**
 * Fetch the public OpenRouter models catalog. Fail-soft to `[]` on any
 * error or non-ok response — a provider outage must never empty the picker.
 */
export async function fetchOpenRouterCatalog(
  fetchImpl: typeof fetch = fetch
): Promise<OpenRouterCatalogModel[]> {
  const url =
    process.env.OPENROUTER_MODELS_API || 'https://openrouter.ai/api/v1/models'
  const referer = process.env.OPENROUTER_REFERER
  const appName = process.env.OPENROUTER_APP_NAME
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(referer ? { 'HTTP-Referer': referer } : {}),
        ...(appName ? { 'X-OpenRouter-Title': appName } : {}),
      },
    })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: OpenRouterCatalogModel[] }
    return Array.isArray(body.data) ? body.data : []
  } catch {
    return []
  }
}

export interface BuildDynamicOptions {
  fetchImpl?: typeof fetch
  topN?: number
  now?: number
  /** Skip cache (tests). */
  forceRefresh?: boolean
}

/**
 * Fetch + rank + take the top N OpenRouter models, mapped to
 * `AgentModelListEntry`. Fail-soft: returns `[]` on any error.
 */
export async function buildOpenRouterDynamicModels(
  options: BuildDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const topN = options.topN ?? getTopN()
  const now = Date.now()

  if (!options.forceRefresh && catalogCache && catalogCache.expiresAt > now) {
    const ranked = rankOpenRouterModels(catalogCache.value, {
      now: options.now,
      limit: topN,
    })
    return ranked.map(rankedToAgentModelEntry)
  }

  const catalog = await fetchOpenRouterCatalog(fetchImpl)
  catalogCache = {
    value: catalog,
    expiresAt: now + OPENROUTER_DYNAMIC_CACHE_TTL_MS,
  }

  const ranked = rankOpenRouterModels(catalog, {
    now: options.now,
    limit: topN,
  })
  return ranked.map(rankedToAgentModelEntry)
}

/**
 * Fail-soft cached helper for the models endpoint: returns `[]` when disabled
 * or on any failure, honouring the TTL cache. Mirrors
 * `loadAnyRouterDynamicModelEntries`.
 */
export async function loadOpenRouterDynamicModelEntries(
  options: BuildDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  if (!isOpenRouterDynamicEnabled() && !options.fetchImpl) return []
  const now = Date.now()
  if (!options.forceRefresh && entriesCache && entriesCache.expiresAt > now) {
    return entriesCache.value
  }
  try {
    const entries = await buildOpenRouterDynamicModels(options)
    entriesCache = {
      value: entries,
      expiresAt: now + OPENROUTER_DYNAMIC_CACHE_TTL_MS,
    }
    return entries
  } catch (error) {
    console.warn(
      '[Agent] OpenRouter dynamic models unavailable:',
      error instanceof Error ? error.message : error
    )
    return []
  }
}
