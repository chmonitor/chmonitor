/**
 * AnyRouter dynamic catalog + usage ranking for the agent model picker.
 *
 * ## API contract (verified against anyrouter.dev, 2026-08-09)
 *
 * - `GET {base}/models` returns `{ data: AnyRouterModelListItem[] }`. Query
 *   params like `sort=usage` / `order=usage` are **not** supported — the list
 *   order is the same catalog order regardless.
 * - Per-model usage lives at `GET {base}/models/{id}/metrics` → field
 *   `request_count` (and success/error/latency stats). Router aliases
 *   (`anyrouter/agent`, `anyrouter/free`, …) often 404 metrics; rank real
 *   model ids only, and surface routers as explicit non-ranked choices.
 *
 * Candidate scoring is capped + cached so the models endpoint never fetches
 * metrics for the entire ~180-model catalog on every request.
 */

import { isFreeAgentModel } from './agent-model-registry'
import { isProviderConfigured } from './providers'
import { formatCompactNumber } from '@/lib/format-number'

// ── Types (AnyRouter public catalog shape) ───────────────────────────────────

/**
 * Subset of `GET /api/v1/models` list items we actually read.
 * Extra fields are ignored.
 */
export interface AnyRouterModelListItem {
  id: string
  name?: string
  description?: string
  context_length?: number
  capabilities?: string[]
  supported_parameters?: string[]
  category?: string
  pricing?: {
    prompt?: string | number
    completion?: string | number
    input_per_1m?: number
    output_per_1m?: number
  }
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
    modality?: string | string[]
  }
  top_provider?: {
    max_completion_tokens?: number | null
  }
}

/** Subset of `GET /api/v1/models/{id}/metrics`. */
export interface AnyRouterModelMetrics {
  model_id?: string
  request_count?: number
  success_count?: number
  error_count?: number
}

/** Ranked candidate ready to merge into the agent models list. */
export interface RankedAnyRouterModel {
  /** Upstream model id (e.g. `google/gemma-4-26b-a4b-it`) */
  modelId: string
  /** Full agent id `anyrouter:{modelId}` */
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
  /** Usage score used for ordering; missing metrics → 0 */
  requestCount: number
  /** True when this entry is a router alias (anyrouter/*), not a concrete model */
  isRouterAlias: boolean
  /** Source of the entry */
  source: 'usage-ranked' | 'router-alias' | 'auto'
}

/** Shape shared with GET /api/v1/agents/models. */
export interface AgentModelListEntry {
  id: string
  modelId: string
  provider: string
  name: string
  description: string
  contextLength: number
  formattedContextLength: string
  maxOutputTokens?: number
  formattedMaxOutputTokens?: string
  isFree: boolean
  available: boolean
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  supportsTools?: boolean
  supportsStreaming?: boolean
  supportsVision?: boolean
  /** Optional usage rank metadata (dynamic AnyRouter only). */
  usageRank?: number
  requestCount?: number
  dynamic?: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Synthetic picker id: resolves at request time to the current top-by-usage model. */
export const ANYROUTER_AUTO_MODEL_ID = 'anyrouter:auto'

/** Router aliases we always surface when present in the catalog. */
export const ANYROUTER_PREFERRED_ROUTER_IDS = [
  'anyrouter/agent',
  'anyrouter/free',
  'anyrouter/coding',
] as const

/** Default max models to score with metrics (bounded fan-out). */
export const DEFAULT_METRICS_CANDIDATE_CAP = 24

/** Default max usage-ranked models to merge into the picker. */
export const DEFAULT_TOP_N = 8

/** In-memory cache TTL for list + metrics aggregate (ms). Matches CDN ~300s. */
export const ANYROUTER_DYNAMIC_CACHE_TTL_MS = 300_000

/** Concurrency for per-model metrics fetches. */
const METRICS_CONCURRENCY = 6

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * True when the model can drive the agent tool loop.
 * Prefer `capabilities` (`function-calling`); fall back to
 * `supported_parameters` tools/tool_choice (OpenRouter-style).
 */
export function isAgentToolCapable(model: AnyRouterModelListItem): boolean {
  const caps = model.capabilities ?? []
  if (caps.some((c) => c.toLowerCase() === 'function-calling')) return true
  const params = model.supported_parameters ?? []
  return params.includes('tools') || params.includes('tool_choice')
}

/** Router / auto-routing catalog ids (no concrete upstream model). */
export function isAnyRouterRouterAlias(modelId: string): boolean {
  return modelId.startsWith('anyrouter/')
}

export function isAnyRouterAutoModelId(fullId: string): boolean {
  // `anyrouter:auto` (preferred) or bare `auto` under anyrouter provider.
  if (fullId === ANYROUTER_AUTO_MODEL_ID) return true
  if (fullId === 'auto') return true
  const colon = fullId.indexOf(':')
  if (colon <= 0) return false
  const provider = fullId.slice(0, colon)
  const model = fullId.slice(colon + 1)
  return (
    provider === 'anyrouter' && (model === 'auto' || model === 'anyrouter/auto')
  )
}

function readPricePair(
  pricing: AnyRouterModelListItem['pricing']
): { input: number; output: number } | null {
  if (!pricing) return null
  const input =
    typeof pricing.input_per_1m === 'number'
      ? pricing.input_per_1m
      : Number(pricing.prompt)
  const output =
    typeof pricing.output_per_1m === 'number'
      ? pricing.output_per_1m
      : Number(pricing.completion)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  return { input, output }
}

function parsePricePerMillion(
  pricing: AnyRouterModelListItem['pricing']
): { inputPerMillion: number; outputPerMillion: number } | undefined {
  const pair = readPricePair(pricing)
  if (!pair) return undefined
  // Omit zero/zero so free models follow free-tier UX.
  if (pair.input === 0 && pair.output === 0) return undefined
  return { inputPerMillion: pair.input, outputPerMillion: pair.output }
}

function isListedAsFree(model: AnyRouterModelListItem): boolean {
  if (isFreeAgentModel(model.id)) return true
  const pair = readPricePair(model.pricing)
  if (pair && pair.input === 0 && pair.output === 0) return true
  return false
}

function supportsVision(model: AnyRouterModelListItem): boolean {
  const modalities = model.architecture?.input_modalities ?? []
  if (modalities.some((m) => m.toLowerCase().includes('image'))) return true
  const caps = model.capabilities ?? []
  return caps.some((c) => c.toLowerCase() === 'vision')
}

function supportsStreaming(model: AnyRouterModelListItem): boolean {
  const outs = model.architecture?.output_modalities
  if (outs?.includes('text')) return true
  const caps = model.capabilities ?? []
  return caps.some((c) => c.toLowerCase() === 'streaming')
}

/**
 * Pick a bounded set of catalog models to fetch metrics for.
 * Prefer tool-capable + coding; skip router aliases (metrics usually 404).
 */
export function selectMetricsCandidates(
  models: readonly AnyRouterModelListItem[],
  maxCandidates: number = DEFAULT_METRICS_CANDIDATE_CAP
): AnyRouterModelListItem[] {
  if (maxCandidates <= 0) return []

  const toolCapable = models.filter(
    (m) => m.id && !isAnyRouterRouterAlias(m.id) && isAgentToolCapable(m)
  )

  // Prefer coding-capable within the tool-capable set, preserve relative order.
  const coding: AnyRouterModelListItem[] = []
  const rest: AnyRouterModelListItem[] = []
  for (const m of toolCapable) {
    const caps = m.capabilities ?? []
    if (caps.some((c) => c.toLowerCase() === 'coding')) coding.push(m)
    else rest.push(m)
  }

  return [...coding, ...rest].slice(0, maxCandidates)
}

export interface RankInput {
  model: AnyRouterModelListItem
  /** `request_count` from metrics; undefined / null means missing. */
  requestCount?: number | null
}

/**
 * Rank tool-capable models by usage (`request_count` desc).
 * Models without metrics rank last (stable by original order among ties).
 * Non-tool models are excluded from the ranked set.
 */
export function rankModelsByUsage(
  rows: readonly RankInput[],
  limit: number = DEFAULT_TOP_N
): RankedAnyRouterModel[] {
  if (limit <= 0) return []

  const eligible = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.model.id &&
        !isAnyRouterRouterAlias(row.model.id) &&
        isAgentToolCapable(row.model)
    )

  eligible.sort((a, b) => {
    const aCount =
      typeof a.row.requestCount === 'number' &&
      Number.isFinite(a.row.requestCount)
        ? a.row.requestCount
        : -1
    const bCount =
      typeof b.row.requestCount === 'number' &&
      Number.isFinite(b.row.requestCount)
        ? b.row.requestCount
        : -1
    if (bCount !== aCount) return bCount - aCount
    return a.index - b.index
  })

  return eligible.slice(0, limit).map(({ row }) =>
    listItemToRanked(row.model, {
      requestCount:
        typeof row.requestCount === 'number' &&
        Number.isFinite(row.requestCount)
          ? row.requestCount
          : 0,
      source: 'usage-ranked',
      isRouterAlias: false,
    })
  )
}

function listItemToRanked(
  model: AnyRouterModelListItem,
  opts: {
    requestCount: number
    source: RankedAnyRouterModel['source']
    isRouterAlias: boolean
  }
): RankedAnyRouterModel {
  const pricing = parsePricePerMillion(model.pricing)
  const maxOut = model.top_provider?.max_completion_tokens
  return {
    modelId: model.id,
    id: `anyrouter:${model.id}`,
    name: model.name || model.id,
    description:
      model.description?.trim() ||
      (opts.isRouterAlias
        ? `AnyRouter router: ${model.id}`
        : `AnyRouter: ${model.id}`),
    contextLength: model.context_length ?? 128_000,
    ...(typeof maxOut === 'number' && maxOut > 0
      ? { maxOutputTokens: maxOut }
      : {}),
    isFree: isListedAsFree(model),
    supportsTools: isAgentToolCapable(model),
    supportsStreaming: supportsStreaming(model),
    supportsVision: supportsVision(model),
    ...(pricing ? { pricing } : {}),
    requestCount: opts.requestCount,
    isRouterAlias: opts.isRouterAlias,
    source: opts.source,
  }
}

/**
 * Pull preferred router aliases from the catalog when present.
 * Order follows ANYROUTER_PREFERRED_ROUTER_IDS.
 */
export function extractPreferredRouters(
  models: readonly AnyRouterModelListItem[]
): RankedAnyRouterModel[] {
  const byId = new Map(models.map((m) => [m.id, m]))
  const out: RankedAnyRouterModel[] = []
  for (const id of ANYROUTER_PREFERRED_ROUTER_IDS) {
    const item = byId.get(id)
    if (!item) continue
    out.push(
      listItemToRanked(item, {
        requestCount: 0,
        source: 'router-alias',
        isRouterAlias: true,
      })
    )
  }
  return out
}

/** Synthetic auto entry for the picker (not a real upstream model id). */
export function buildAnyRouterAutoEntry(
  topModelId: string | null
): RankedAnyRouterModel {
  const tip = topModelId
    ? `Currently resolves to ${topModelId} (top tool-capable by usage).`
    : 'Resolves to the highest-usage tool-capable model on AnyRouter, with a static fallback if the catalog is unavailable.'
  return {
    modelId: 'auto',
    id: ANYROUTER_AUTO_MODEL_ID,
    name: 'Auto (top by usage)',
    description: `Auto-pick top AnyRouter model by usage. ${tip}`,
    contextLength: 200_000,
    isFree: true,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    requestCount: 0,
    isRouterAlias: false,
    source: 'auto',
  }
}

export function rankedToAgentModelEntry(
  ranked: RankedAnyRouterModel,
  rankIndex?: number
): AgentModelListEntry {
  return {
    id: ranked.id,
    modelId: ranked.modelId,
    provider: 'anyrouter',
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
    available: isProviderConfigured('anyrouter'),
    ...(ranked.pricing ? { pricing: ranked.pricing } : {}),
    supportsTools: ranked.supportsTools,
    supportsStreaming: ranked.supportsStreaming,
    supportsVision: ranked.supportsVision,
    dynamic: true,
    ...(typeof rankIndex === 'number' ? { usageRank: rankIndex + 1 } : {}),
    ...(ranked.source === 'usage-ranked'
      ? { requestCount: ranked.requestCount }
      : {}),
  }
}

/**
 * Merge dynamic AnyRouter entries with the static/registry list.
 *
 * Win rules:
 * - Dedupe by full `id` (`anyrouter:…`).
 * - Static/registry entries win when the same id already exists (curated copy).
 * - Dynamic-only ids are inserted at the front (auto → routers → usage-ranked).
 */
export function mergeAnyRouterDynamicModels<T extends { id: string }>(
  staticModels: readonly T[],
  dynamicModels: readonly T[]
): T[] {
  const seen = new Set(staticModels.map((m) => m.id))
  const extras = dynamicModels.filter((m) => !seen.has(m.id))
  return [...extras, ...staticModels]
}

/**
 * Pure selection of the auto-resolved model id from a ranked list.
 * Returns the first usage-ranked (or first tool-capable) full id, or null.
 */
export function pickTopUsageModelId(
  ranked: readonly RankedAnyRouterModel[]
): string | null {
  const usage = ranked.find(
    (m) => m.source === 'usage-ranked' && m.supportsTools && m.requestCount > 0
  )
  if (usage) return usage.id
  const anyUsage = ranked.find(
    (m) => m.source === 'usage-ranked' && m.supportsTools
  )
  if (anyUsage) return anyUsage.id
  return null
}

// ── I/O + cache ──────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

let catalogCache: CacheEntry<AnyRouterModelListItem[]> | null = null
let rankedCache: CacheEntry<{
  ranked: RankedAnyRouterModel[]
  topId: string | null
}> | null = null

/** Test-only: clear in-memory caches. */
export function __resetAnyRouterDynamicCachesForTests(): void {
  catalogCache = null
  rankedCache = null
}

function anyRouterBaseURL(): string {
  return (
    process.env.ANYROUTER_API_BASE?.trim() || 'https://anyrouter.dev/api/v1'
  ).replace(/\/$/, '')
}

function anyRouterHeaders(): HeadersInit {
  const key = process.env.ANYROUTER_API_KEY?.trim()
  return {
    Accept: 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

/**
 * Whether dynamic AnyRouter enrichment should run.
 * Fail-closed: requires AnyRouter provider configured (API key present).
 * Optional kill-switch: ANYROUTER_DYNAMIC_MODELS=false|0|off.
 */
export function isAnyRouterDynamicEnabled(): boolean {
  const flag = process.env.ANYROUTER_DYNAMIC_MODELS?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') {
    return false
  }
  return isProviderConfigured('anyrouter')
}

export function getDynamicTopN(): number {
  const raw = process.env.ANYROUTER_TOP_MODELS_N?.trim()
  if (!raw) return DEFAULT_TOP_N
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOP_N
  return Math.min(n, 32)
}

export function getMetricsCandidateCap(): number {
  const raw = process.env.ANYROUTER_METRICS_CANDIDATE_CAP?.trim()
  if (!raw) return DEFAULT_METRICS_CANDIDATE_CAP
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_METRICS_CANDIDATE_CAP
  return Math.min(n, 64)
}

export async function fetchAnyRouterCatalog(
  fetchImpl: typeof fetch = fetch
): Promise<AnyRouterModelListItem[]> {
  const now = Date.now()
  if (catalogCache && catalogCache.expiresAt > now) {
    return catalogCache.value
  }

  const url = `${anyRouterBaseURL()}/models`
  const response = await fetchImpl(url, { headers: anyRouterHeaders() })
  if (!response.ok) {
    throw new Error(`AnyRouter models list error: ${response.status}`)
  }
  const body = (await response.json()) as {
    data?: AnyRouterModelListItem[]
  }
  const data = Array.isArray(body.data) ? body.data : []
  catalogCache = {
    value: data,
    expiresAt: now + ANYROUTER_DYNAMIC_CACHE_TTL_MS,
  }
  return data
}

export async function fetchAnyRouterMetrics(
  modelId: string,
  fetchImpl: typeof fetch = fetch
): Promise<AnyRouterModelMetrics | null> {
  const encoded = encodeURIComponent(modelId)
  const url = `${anyRouterBaseURL()}/models/${encoded}/metrics`
  try {
    const response = await fetchImpl(url, { headers: anyRouterHeaders() })
    if (!response.ok) return null
    return (await response.json()) as AnyRouterModelMetrics
  } catch {
    return null
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

export interface BuildDynamicOptions {
  fetchImpl?: typeof fetch
  topN?: number
  candidateCap?: number
  /** Skip cache (tests). */
  forceRefresh?: boolean
}

/**
 * Fetch catalog + bounded metrics, rank, and return ranked dynamic entries
 * (auto + routers + top-N usage). Fail-soft callers should catch.
 */
export async function buildAnyRouterDynamicModels(
  options: BuildDynamicOptions = {}
): Promise<{
  entries: RankedAnyRouterModel[]
  topUsageId: string | null
}> {
  const fetchImpl = options.fetchImpl ?? fetch
  const topN = options.topN ?? getDynamicTopN()
  const candidateCap = options.candidateCap ?? getMetricsCandidateCap()
  const now = Date.now()

  if (!options.forceRefresh && rankedCache && rankedCache.expiresAt > now) {
    return {
      entries: rankedCache.value.ranked,
      topUsageId: rankedCache.value.topId,
    }
  }

  const catalog = await fetchAnyRouterCatalog(fetchImpl)
  const candidates = selectMetricsCandidates(catalog, candidateCap)

  const metrics = await mapPool(candidates, METRICS_CONCURRENCY, async (m) => {
    const met = await fetchAnyRouterMetrics(m.id, fetchImpl)
    return {
      model: m,
      requestCount:
        typeof met?.request_count === 'number' ? met.request_count : null,
    } satisfies RankInput
  })

  // Also include candidate rows that somehow weren't fetched — should not happen.
  const rankedUsage = rankModelsByUsage(metrics, topN)
  const routers = extractPreferredRouters(catalog)
  const topUsageId = pickTopUsageModelId(rankedUsage)
  const auto = buildAnyRouterAutoEntry(
    topUsageId ? topUsageId.replace(/^anyrouter:/, '') : null
  )

  const entries = [auto, ...routers, ...rankedUsage]
  rankedCache = {
    value: { ranked: entries, topId: topUsageId },
    expiresAt: now + ANYROUTER_DYNAMIC_CACHE_TTL_MS,
  }

  return { entries, topUsageId }
}

/**
 * Resolve `anyrouter:auto` to a concrete `anyrouter:{modelId}`.
 * Returns null when dynamic ranking is unavailable (caller uses static default).
 */
export async function resolveAnyRouterAutoModelId(
  options: BuildDynamicOptions = {}
): Promise<string | null> {
  if (!isAnyRouterDynamicEnabled() && !options.fetchImpl) {
    // Still allow explicit resolve when tests inject fetchImpl without env.
    if (!options.forceRefresh && !rankedCache) return null
  }
  try {
    // Use cache when warm; otherwise build (may no-op if unconfigured and no fetch).
    if (!isAnyRouterDynamicEnabled() && !options.fetchImpl) return null
    const { topUsageId } = await buildAnyRouterDynamicModels(options)
    return topUsageId
  } catch {
    return null
  }
}

/**
 * Fail-soft helper for the models endpoint: returns [] when disabled or on error.
 */
export async function loadAnyRouterDynamicModelEntries(
  options: BuildDynamicOptions = {}
): Promise<AgentModelListEntry[]> {
  if (!isAnyRouterDynamicEnabled() && !options.fetchImpl) return []
  try {
    const { entries } = await buildAnyRouterDynamicModels(options)
    let usageIndex = 0
    return entries.map((e) => {
      if (e.source === 'usage-ranked') {
        const entry = rankedToAgentModelEntry(e, usageIndex)
        usageIndex += 1
        return entry
      }
      return rankedToAgentModelEntry(e)
    })
  } catch (error) {
    console.warn(
      '[Agent] AnyRouter dynamic models unavailable:',
      error instanceof Error ? error.message : error
    )
    return []
  }
}
