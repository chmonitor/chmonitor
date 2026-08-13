'use client'

/**
 * useAgentModel Hook
 *
 * Client-side hook for managing agent model selection.
 * Persists selection to localStorage and provides model metadata.
 *
 * Model IDs use `provider:model` format (e.g., `openrouter:qwen/qwen3-coder:free`).
 * Legacy IDs without `:` are treated as `openrouter:{model}`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FALLBACK_AGENT_MODEL,
  getAllModelOptions,
  MODEL_REGISTRY,
} from '@/lib/ai/agent-model-registry'
import {
  formatTokenCount,
  isFreeAgentModel,
  type ModelPricing,
  type OpenAIModel,
} from '@/lib/ai/agent-models'
import {
  ANYROUTER_TOKEN_CHANGE_EVENT,
  getAnyRouterToken,
} from '@/lib/hooks/use-anyrouter-token'
import { apiFetch } from '@/lib/swr/api-fetch'

export type { OpenAIModel } from '@/lib/ai/agent-models'

const MODEL_STORAGE_KEY = 'clickhouse-monitor-agent-model'

/** Recently selected model ids, most recent first. */
const RECENT_STORAGE_KEY = 'clickhouse-monitor-agent-model-recent'
/** Model ids typed by hand in the picker's custom-model input. */
const CUSTOM_STORAGE_KEY = 'clickhouse-monitor-agent-model-custom'

/** How many recently used models the picker keeps pinned to the top. */
export const MAX_RECENT_MODELS = 5
/** Upper bound on hand-entered model ids, so localStorage cannot grow forever. */
const MAX_CUSTOM_MODELS = 20

function readStoredList(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    )
  } catch {
    // localStorage disabled, or a corrupt value from an older build
    return []
  }
}

function writeStoredList(key: string, values: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch {
    // localStorage may be disabled
  }
}

function pushRecentModel(id: string): void {
  const next = [
    id,
    ...readStoredList(RECENT_STORAGE_KEY).filter((v) => v !== id),
  ]
  writeStoredList(RECENT_STORAGE_KEY, next.slice(0, MAX_RECENT_MODELS))
}

/**
 * Validate a hand-entered model id.
 *
 * Deliberately shape-only (`provider:model`): the whole point of the custom
 * input is to reach a model the dynamic catalog does not list, so it must NOT
 * be checked against the fetched list. The provider must still be one the
 * server knows how to route, otherwise the first message would 400.
 *
 * @param raw - Raw text from the picker input
 * @param knownProviders - Provider ids the server reports (empty = accept any)
 * @returns The normalized id, or an error message explaining the rejection
 */
export function parseCustomModelId(
  raw: string,
  knownProviders: readonly string[] = []
): { id: string } | { error: string } {
  const value = raw.trim()
  if (value.length === 0) return { error: 'Enter a model id' }
  if (value.length > 200) return { error: 'Model id is too long' }
  if (/\s/.test(value)) return { error: 'Model id cannot contain spaces' }

  const idx = value.indexOf(':')
  if (idx <= 0 || idx === value.length - 1) {
    return { error: 'Use provider:model — e.g. openrouter:qwen/qwen3-coder' }
  }

  const provider = value.slice(0, idx)
  if (knownProviders.length > 0 && !knownProviders.includes(provider)) {
    return { error: `Unknown provider "${provider}"` }
  }

  return { id: value }
}

/**
 * Client default when no saved selection exists and the models API has not
 * loaded yet. Prefer OpenRouter free (works with LLM_API_KEY / OPENROUTER_API_KEY)
 * — never hardcode AnyRouter, which would 503 when ANYROUTER_API_KEY is unset.
 * Format as `provider:model` for the agent route.
 */
const DEFAULT_MODEL: OpenAIModel = FALLBACK_AGENT_MODEL.includes(':')
  ? (FALLBACK_AGENT_MODEL as OpenAIModel)
  : (`openrouter:${FALLBACK_AGENT_MODEL}` as OpenAIModel)

/**
 * Ensure a model identifier is in `provider:model` form.
 *
 * @param id - A model identifier, either already provider-qualified (`provider:model`) or legacy (just the model name)
 * @returns The normalized identifier in `provider:model` form; if `id` has no `:`, `openrouter:` is prefixed
 */
function normalizeModelId(id: string): string {
  if (id.includes(':')) return id
  return `openrouter:${id}`
}

/**
 * Return the configured default agent model.
 *
 * @returns The default `OpenAIModel` value used when no saved model exists
 */
function getDefaultModel(): OpenAIModel {
  return DEFAULT_MODEL
}

export function getSavedModel(): OpenAIModel {
  if (typeof window === 'undefined') return getDefaultModel()

  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY)
    if (saved && saved.trim().length > 0) {
      return normalizeModelId(saved)
    }
  } catch {
    // localStorage may be disabled
  }

  return getDefaultModel()
}

/**
 * Persist the selected agent model identifier to browser localStorage.
 *
 * Does nothing when not running in a browser or if storage is unavailable or disabled; storage errors are silently ignored.
 *
 * @param model - Model identifier to store under the key 'clickhouse-monitor-agent-model'
 */
function saveModel(model: OpenAIModel): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model)
  } catch {
    // localStorage may be disabled
  }
}

/**
 * Removes the persisted agent model selection from browser localStorage.
 *
 * Does nothing when not running in a browser. Any errors thrown by storage access are ignored.
 */
function clearSavedModel(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(MODEL_STORAGE_KEY)
  } catch {
    // localStorage may be disabled
  }
}

export interface ModelDisplayInfo {
  id: OpenAIModel
  modelId: string
  provider: string
  name: string
  description: string
  contextLength: number
  formattedContextLength: string
  /** Max completion (output) tokens, when the upstream API reports it. */
  maxOutputTokens?: number
  formattedMaxOutputTokens?: string
  isFree: boolean
  /** True when the Worker has an API key for this provider. Defaults to true offline. */
  available?: boolean
  pricing?: ModelPricing
  supportsTools?: boolean
  supportsStreaming?: boolean
  supportsVision?: boolean
}

export interface UseAgentModelResult {
  model: OpenAIModel
  models: readonly ModelDisplayInfo[]
  setModel: (model: OpenAIModel) => void
  resetModel: () => void
  /** Recently selected model ids, most recent first (max {@link MAX_RECENT_MODELS}). */
  recentModelIds: readonly string[]
  /**
   * Add a hand-entered `provider:model` id and select it.
   *
   * @returns `null` on success, or a human-readable rejection reason
   */
  addCustomModel: (raw: string) => string | null
  /** Forget a hand-entered model id. */
  removeCustomModel: (id: string) => void
  /** True once /api/v1/agents/models has returned (possibly empty). */
  modelsLoaded: boolean
  /**
   * Provider ids with a key on this deployment (from models API).
   * Empty array means no LLM keys — agent chat cannot run.
   */
  configuredProviders: readonly string[]
  /** True when models API reports zero configured providers. */
  noProvidersConfigured: boolean
}

function getStaticModels(): ModelDisplayInfo[] {
  return getAllModelOptions().map((id): ModelDisplayInfo => {
    const idx = id.indexOf(':')
    const provider = id.slice(0, idx)
    const modelId = id.slice(idx + 1)
    const entry = MODEL_REGISTRY.find((m) => m.id === modelId)
    const isFree = isFreeAgentModel(modelId)

    return {
      id,
      modelId,
      provider,
      name: modelId,
      description: entry?.description ?? modelId,
      contextLength: entry?.contextLength ?? 131_072,
      formattedContextLength: formatTokenCount(entry?.contextLength ?? 131_072),
      isFree,
      pricing: entry?.pricing,
    }
  })
}

/**
 * Build a display entry for a hand-entered model id.
 *
 * The catalog knows nothing about it, so metadata is deliberately minimal —
 * the picker badges these rows as `custom`.
 */
function customModelEntry(id: string): ModelDisplayInfo {
  const idx = id.indexOf(':')
  const provider = id.slice(0, idx)
  const modelId = id.slice(idx + 1)

  return {
    id,
    modelId,
    provider,
    name: modelId,
    description: 'Custom model id',
    contextLength: 0,
    formattedContextLength: 'unknown',
    isFree: false,
  }
}

/**
 * Curated entries for a provider the deployment has no key for, but the user
 * does (BYOK). The server filters these out of `/api/v1/agents/models` because
 * it cannot know about a browser-held token — so add them back client-side.
 */
export function byokProviderModels(
  providers: readonly string[]
): ModelDisplayInfo[] {
  if (providers.length === 0) return []
  return getStaticModels().filter((m) => providers.includes(m.provider))
}

/** Append custom entries that the catalog does not already list. */
function withCustomModels(
  models: ModelDisplayInfo[],
  customIds: readonly string[]
): ModelDisplayInfo[] {
  const seen = new Set(models.map((m) => m.id))
  return [
    ...models,
    ...customIds.filter((id) => !seen.has(id)).map(customModelEntry),
  ]
}

async function fetchModelsWithCapabilities(): Promise<{
  models: ModelDisplayInfo[]
  configuredProviders: string[]
}> {
  try {
    const response = await apiFetch('/api/v1/agents/models')
    if (!response.ok) {
      throw new Error('Failed to fetch models')
    }
    // configuredProviders is a new top-level field; tolerate its absence.
    const data = (await response.json()) as {
      models: ModelDisplayInfo[]
      configuredProviders?: string[]
    }
    return {
      models: data.models,
      configuredProviders: data.configuredProviders ?? [],
    }
  } catch {
    // Offline / error: keep static list for local dev; configuredProviders
    // unknown so leave empty (UI will not claim "no providers" incorrectly).
    return { models: getStaticModels(), configuredProviders: [] }
  }
}

const MODEL_CHANGE_EVENT = 'clickhouse-monitor-agent-model-changed'

function emitModelChange(model: OpenAIModel | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<OpenAIModel | null>(MODEL_CHANGE_EVENT, { detail: model })
  )
}

/**
 * Manages the selected agent model, the available model list (with best-effort
 * capability fetch), and handlers to change or reset the selection.
 *
 * Changing the model updates `localStorage` and broadcasts a custom event so
 * any other `useAgentModel` consumer on the page picks up the new value
 * without a full page reload — the agent runtime swaps to the new model on
 * the next request.
 */
export function useAgentModel(): UseAgentModelResult {
  const [model, setModelState] = useState<OpenAIModel>(() => getSavedModel())

  const [customIds, setCustomIds] = useState<string[]>(() =>
    readStoredList(CUSTOM_STORAGE_KEY)
  )
  const [recentModelIds, setRecentModelIds] = useState<string[]>(() =>
    readStoredList(RECENT_STORAGE_KEY)
  )
  const [catalog, setCatalog] = useState<ModelDisplayInfo[]>(getStaticModels)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])

  // Providers the *user* holds a token for (AnyRouter sign-in), which the
  // server cannot see. Re-read whenever that token changes.
  const [byokProviders, setByokProviders] = useState<string[]>(() =>
    getAnyRouterToken() ? ['anyrouter'] : []
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () =>
      setByokProviders(getAnyRouterToken() ? ['anyrouter'] : [])
    sync()
    window.addEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, sync)
    return () => window.removeEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, sync)
  }, [])

  const models = useMemo(() => {
    const known = new Set(catalog.map((m) => m.id))
    const byok = byokProviderModels(byokProviders).filter(
      (m) => !known.has(m.id)
    )
    return withCustomModels([...catalog, ...byok], customIds)
  }, [catalog, customIds, byokProviders])

  // Read inside the load effect without making it re-run on every edit.
  const customIdsRef = useRef(customIds)
  customIdsRef.current = customIds

  useEffect(() => {
    let cancelled = false

    async function loadModels() {
      const { models: nextModels, configuredProviders: nextProviders } =
        await fetchModelsWithCapabilities()
      if (cancelled) return

      setModelsLoaded(true)
      setConfiguredProviders(nextProviders)

      // Empty list = no provider keys on this deployment (or only
      // unconfigured providers were filtered out). Clear the picker and keep
      // the last model id only as a soft preference until keys exist.
      if (nextModels.length === 0) {
        setCatalog([])
        return
      }

      setCatalog(nextModels)

      // If the persisted model is no longer selectable (provider not
      // configured on this deployment, or missing from the list), fall back to
      // the first model whose provider IS configured. This prevents the first
      // message from 503-ing because the client sent a model whose provider
      // has no API key (e.g. a hardcoded `anyrouter:*` default on a deployment
      // that only configured OpenRouter).
      const configured = nextModels.filter((m) => m.available !== false)
      const fallbackPool = configured.length > 0 ? configured : nextModels
      let fallbackId: OpenAIModel | undefined
      setModelState((current) => {
        // A hand-entered id is intentionally absent from the catalog — never
        // fall it back, or the custom-model input would undo itself on load.
        if (customIdsRef.current.includes(current)) return current
        const stillAvailable =
          nextModels.some((m) => m.id === current) &&
          nextModels.find((m) => m.id === current)?.available !== false
        if (stillAvailable) return current
        fallbackId = fallbackPool[0]?.id
        return fallbackId ?? current
      })

      // Side effects outside the updater — save and broadcast fallback
      if (fallbackId) {
        saveModel(fallbackId)
        emitModelChange(fallbackId)
      }
    }

    loadModels()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenAIModel | null>).detail
      setModelState(detail ?? getSavedModel())
    }
    window.addEventListener(MODEL_CHANGE_EVENT, handler)
    return () => window.removeEventListener(MODEL_CHANGE_EVENT, handler)
  }, [])

  const setModel = (newModel: OpenAIModel): void => {
    saveModel(newModel)
    pushRecentModel(newModel)
    setRecentModelIds(readStoredList(RECENT_STORAGE_KEY))
    setModelState(newModel)
    emitModelChange(newModel)
  }

  const addCustomModel = (raw: string): string | null => {
    // A BYOK provider is routable even though the server does not list it.
    const parsed = parseCustomModelId(raw, [
      ...configuredProviders,
      ...byokProviders,
    ])
    if ('error' in parsed) return parsed.error

    const next = [parsed.id, ...customIds.filter((v) => v !== parsed.id)].slice(
      0,
      MAX_CUSTOM_MODELS
    )
    writeStoredList(CUSTOM_STORAGE_KEY, next)
    setCustomIds(next)
    setModel(parsed.id)
    return null
  }

  const removeCustomModel = (id: string): void => {
    const next = customIds.filter((v) => v !== id)
    writeStoredList(CUSTOM_STORAGE_KEY, next)
    setCustomIds(next)
  }

  const resetModel = (): void => {
    clearSavedModel()
    const fallback = getDefaultModel()
    setModelState(fallback)
    emitModelChange(null)
  }

  return {
    model,
    models,
    setModel,
    resetModel,
    recentModelIds,
    addCustomModel,
    removeCustomModel,
    modelsLoaded,
    configuredProviders,
    noProvidersConfigured:
      modelsLoaded && configuredProviders.length === 0 && models.length === 0,
  }
}
