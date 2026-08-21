/**
 * AnyRouter user presets, surfaced as selectable entries in the agent model
 * picker.
 *
 * ## API contract (verified against https://anyrouter.dev/docs/features/presets.md
 * and https://anyrouter.dev/docs/api-reference/presets.md, 2026-08-13)
 *
 * - `GET {base}/models` is public. When called WITH an
 *   `Authorization: Bearer sk-ar-…` header, the response additionally carries
 *   a top-level `presets` array (an authenticated user's saved presets). The
 *   `?presets=0` query param opts out of that inclusion. Unauthenticated
 *   requests never receive `presets`. `GET {base}/presets` also exists but
 *   requires auth (401s anonymously) — this module reuses the `/models` call
 *   (same request the dynamic-catalog module already makes) rather than
 *   issuing a second one, since the presets ride along "for free" whenever a
 *   key is configured.
 * - A preset is addressable as a model: the chat-completions `model` field
 *   accepts `@preset/<slug>` (also `@presets/<slug>` for branch/BYOK
 *   routing). In this codebase's `provider:model` id scheme a preset becomes
 *   `anyrouter:@preset/<slug>`.
 * - Preset object shape: `{ slug, name, description?, config: { model?,
 *   system?, temperature?, max_tokens?, ... } }`. Only `slug` is required;
 *   everything else is treated as optional/untrusted and validated
 *   defensively below.
 */

import type { AgentModelListEntry } from './anyrouter-dynamic-models'

import { ANYROUTER_DYNAMIC_CACHE_TTL_MS } from './anyrouter-dynamic-models'
import { isProviderConfigured } from './providers'

// ── Types ────────────────────────────────────────────────────────────────────

/** Subset of the AnyRouter preset object we actually read. */
export interface AnyRouterPreset {
  slug: string
  name?: string
  description?: string
  config?: {
    model?: string
    system?: string
    temperature?: number
    max_tokens?: number
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Model-id prefix identifying an AnyRouter preset (vs. a concrete model). */
export const ANYROUTER_PRESET_MODEL_PREFIX = '@preset/'

/** Alternate prefix accepted for branch/BYOK preset routing. */
const ANYROUTER_PRESET_MODEL_PREFIX_ALT = '@presets/'

/** Default max presets surfaced in the picker (env-overridable). */
const DEFAULT_PRESETS_MAX = 8

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * True when `id` (the full `provider:model` agent id) addresses an AnyRouter
 * preset, e.g. `anyrouter:@preset/my-preset`. Tolerates the `@presets/`
 * variant.
 */
export function isAnyRouterPresetModelId(id: string): boolean {
  const colon = id.indexOf(':')
  if (colon <= 0) return false
  const provider = id.slice(0, colon)
  const model = id.slice(colon + 1)
  if (provider !== 'anyrouter') return false
  return (
    model.startsWith(ANYROUTER_PRESET_MODEL_PREFIX) ||
    model.startsWith(ANYROUTER_PRESET_MODEL_PREFIX_ALT)
  )
}

/**
 * Convert a validated preset into a picker entry.
 *
 * `contextLength`/`formattedContextLength`: a preset does not report a
 * context window of its own (it wraps an underlying model chosen by
 * `config.model`, which this module has no catalog access to resolve
 * honestly). Rather than fabricate a plausible-looking number, this reports
 * `0` / `'—'` — callers rendering context length should treat `0` as "unknown"
 * for preset entries.
 */
export function presetToAgentModelEntry(
  preset: AnyRouterPreset,
  _opts: Record<string, never> = {}
): AgentModelListEntry {
  const modelId = `${ANYROUTER_PRESET_MODEL_PREFIX}${preset.slug}`
  const label = preset.name?.trim() || preset.slug
  const description =
    preset.description?.trim() ||
    (preset.config?.model
      ? `AnyRouter preset "${label}" (routes to ${preset.config.model})`
      : `AnyRouter preset "${label}"`)

  return {
    id: `anyrouter:${modelId}`,
    modelId,
    provider: 'anyrouter',
    name: modelId,
    description,
    contextLength: 0,
    formattedContextLength: '—',
    isFree: false,
    available: true,
  }
}

/**
 * Merge preset entries into the base model list.
 * Base entries always win on id collision; presets are appended, deduped.
 */
export function mergeAnyRouterPresets(
  base: readonly AgentModelListEntry[],
  presets: readonly AgentModelListEntry[]
): AgentModelListEntry[] {
  const seen = new Set(base.map((m) => m.id))
  const extras: AgentModelListEntry[] = []
  for (const p of presets) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    extras.push(p)
  }
  return [...base, ...extras]
}

function isValidPreset(value: unknown): value is AnyRouterPreset {
  if (!value || typeof value !== 'object') return false
  const slug = (value as Record<string, unknown>).slug
  return typeof slug === 'string' && slug.trim().length > 0
}

/** Defensively parse the top-level `presets` array from a `/models` response body. */
function parsePresets(body: unknown): AnyRouterPreset[] {
  if (!body || typeof body !== 'object') return []
  const raw = (body as Record<string, unknown>).presets
  if (!Array.isArray(raw)) return []
  const out: AnyRouterPreset[] = []
  for (const item of raw) {
    if (isValidPreset(item)) out.push(item)
  }
  return out
}

// ── Env gating ───────────────────────────────────────────────────────────────

/**
 * Whether AnyRouter presets should be surfaced.
 * Fail-closed: requires the AnyRouter provider configured (API key present).
 * Optional kill-switch: ANYROUTER_PRESETS=false|0|off|no.
 */
function isAnyRouterPresetsEnabled(): boolean {
  const flag = process.env.ANYROUTER_PRESETS?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') {
    return false
  }
  return isProviderConfigured('anyrouter')
}

/** Max number of presets to surface, clamped to [1, 32]. */
function getPresetsMax(): number {
  const raw = process.env.ANYROUTER_PRESETS_MAX?.trim()
  if (!raw) return DEFAULT_PRESETS_MAX
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PRESETS_MAX
  return Math.min(Math.max(n, 1), 32)
}

// ── I/O + cache ──────────────────────────────────────────────────────────────

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

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

let presetsCache: CacheEntry<AnyRouterPreset[]> | null = null

/** Test-only: clear in-memory caches. */
export function __resetAnyRouterPresetCachesForTests(): void {
  presetsCache = null
}

/**
 * Fetch the signed-in user's AnyRouter presets via the authenticated
 * `GET {base}/models` response. Fail-soft: returns `[]` on any error,
 * missing key, or malformed response — never throws, never logs the key.
 */
export async function fetchAnyRouterPresets(
  fetchImpl: typeof fetch = fetch
): Promise<AnyRouterPreset[]> {
  try {
    const key = process.env.ANYROUTER_API_KEY?.trim()
    if (!key) return []

    const url = `${anyRouterBaseURL()}/models`
    const response = await fetchImpl(url, { headers: anyRouterHeaders() })
    if (!response.ok) return []
    const body = await response.json()
    return parsePresets(body)
  } catch {
    return []
  }
}

interface LoadOptions {
  fetchImpl?: typeof fetch
  /** Skip cache (tests). */
  forceRefresh?: boolean
}

/**
 * Fail-soft, TTL-cached, gated loader: presets ready to merge into the agent
 * model list. Returns `[]` when disabled, unconfigured, or on any error —
 * never throws, and never lets a presets failure break the model list.
 */
export async function loadAnyRouterPresetEntries(
  options: LoadOptions = {}
): Promise<AgentModelListEntry[]> {
  if (!isAnyRouterPresetsEnabled()) return []

  const now = Date.now()
  let presets: AnyRouterPreset[]
  if (!options.forceRefresh && presetsCache && presetsCache.expiresAt > now) {
    presets = presetsCache.value
  } else {
    presets = await fetchAnyRouterPresets(options.fetchImpl ?? fetch)
    presetsCache = {
      value: presets,
      expiresAt: now + ANYROUTER_DYNAMIC_CACHE_TTL_MS,
    }
  }

  const capped = presets.slice(0, getPresetsMax())
  try {
    return capped.map((p) => presetToAgentModelEntry(p))
  } catch {
    return []
  }
}
