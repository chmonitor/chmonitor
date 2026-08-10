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

import { useEffect, useState } from 'react'
import {
  getAllModelOptions,
  MODEL_REGISTRY,
} from '@/lib/ai/agent-model-registry'
import {
  formatTokenCount,
  isFreeAgentModel,
  type ModelPricing,
  type OpenAIModel,
} from '@/lib/ai/agent-models'
import { ANYROUTER_AUTO_MODEL_ID } from '@/lib/ai/anyrouter-dynamic-models'
import { apiFetch } from '@/lib/swr/api-fetch'

export type { OpenAIModel } from '@/lib/ai/agent-models'

const MODEL_STORAGE_KEY = 'clickhouse-monitor-agent-model'

/**
 * Client default when no saved selection exists.
 * Prefer the AnyRouter auto alias (resolved server-side to top-by-usage);
 * curated Gemma remains the static registry fallback for offline/static lists.
 */
const DEFAULT_MODEL = ANYROUTER_AUTO_MODEL_ID

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

async function fetchModelsWithCapabilities(): Promise<ModelDisplayInfo[]> {
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
    return data.models
  } catch {
    return getStaticModels()
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

  const [models, setModels] = useState<ModelDisplayInfo[]>(getStaticModels)

  useEffect(() => {
    let cancelled = false

    async function loadModels() {
      const nextModels = await fetchModelsWithCapabilities()
      if (cancelled || nextModels.length === 0) return

      setModels(nextModels)

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
        const stillAvailable =
          nextModels.some((m) => m.id === current) &&
          nextModels.find((m) => m.id === current)?.available !== false
        if (stillAvailable) return current
        fallbackId = fallbackPool[0].id
        return fallbackId
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
    setModelState(newModel)
    emitModelChange(newModel)
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
  }
}
