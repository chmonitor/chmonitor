/**
 * Agent Models Endpoint
 *
 * GET /api/v1/agents/models
 *
 * Returns available models grouped by provider.
 * Generates all valid `provider:model` combinations from MODEL_REGISTRY.
 * Enriches OpenRouter models with capability data from their API.
 *
 * Ported from apps/dashboard/app/api/v1/agents/models/route.ts.
 * - next/server NextResponse.json(x, init) -> Response.json(x, init).
 * - Dropped the Next-only `next: { revalidate }` fetch option on the OpenRouter
 *   call (not a standard Web fetch option). Worker/edge caching is not applied
 *   here; the upstream response is fetched per request. CACHE_TTL_SECONDS is
 *   retained as documentation of the previous revalidation window.
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  getModelRegistry,
  isFreeAgentModel,
} from '@/lib/ai/agent-model-registry'
import { isProviderConfigured, PROVIDERS } from '@/lib/ai/providers'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'
import { formatCompactNumber } from '@/lib/format-number'

const OPENROUTER_MODELS_API =
  process.env.OPENROUTER_MODELS_API || 'https://openrouter.ai/api/v1/models'
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME

interface ModelCapability {
  /** Combined ID in `provider:model` format */
  id: string
  /** Provider-agnostic model ID */
  modelId: string
  /** Provider ID */
  provider: string
  /** Display name */
  name: string
  description: string
  contextLength: number
  formattedContextLength: string
  /** Max completion (output) tokens, when the upstream API reports it. */
  maxOutputTokens?: number
  formattedMaxOutputTokens?: string
  isFree: boolean
  /** True when the Worker has an API key configured for this provider. */
  available: boolean
  pricing?: {
    inputPerMillion: number
    outputPerMillion: number
  }
  supportsTools?: boolean
  supportsStreaming?: boolean
  supportsVision?: boolean
}

/**
 * Fetch OpenRouter model metadata for capability enrichment.
 */
async function fetchOpenRouterCapabilities(): Promise<
  Map<string, Record<string, unknown>>
> {
  const response = await fetch(OPENROUTER_MODELS_API, {
    headers: {
      ...(OPENROUTER_REFERER && {
        'HTTP-Referer': OPENROUTER_REFERER,
      }),
      ...(OPENROUTER_APP_NAME && {
        'X-OpenRouter-Title': OPENROUTER_APP_NAME,
      }),
    },
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`)
  }

  const data = (await response.json()) as {
    data: Array<{
      id: string
      context_length?: number
      supported_parameters?: string[]
      architecture?: {
        input_modalities?: string[]
        output_modalities?: string[]
        modality?: string | string[]
      }
      top_provider?: {
        max_completion_tokens?: number | null
      }
    }>
  }

  return new Map(
    data.data.map((m) => [
      m.id,
      {
        contextLength: m.context_length,
        supportedParameters: m.supported_parameters,
        architecture: m.architecture,
        maxOutputTokens: m.top_provider?.max_completion_tokens ?? undefined,
      },
    ])
  )
}

function extractCapabilities(
  orData: Record<string, unknown> | undefined
): Pick<
  ModelCapability,
  'supportsTools' | 'supportsStreaming' | 'supportsVision'
> {
  if (!orData) return {}

  const architecture = orData.architecture as ModelCapability extends never
    ? never
    :
        | {
            input_modalities?: string[]
            output_modalities?: string[]
            modality?: string | string[]
          }
        | undefined
  const supportedParameters = (orData as { supportedParameters?: string[] })
    .supportedParameters

  const supportsTools =
    supportedParameters?.includes('tools') ||
    supportedParameters?.includes('tool_choice')

  const rawModality = architecture?.modality
  const modalityList = Array.isArray(rawModality)
    ? rawModality
    : rawModality
      ? [rawModality]
      : []
  const inputModalities = [
    ...(architecture?.input_modalities ?? []),
    ...modalityList.map((m: string) => m.split('->')[0] ?? ''),
  ].map((m: string) => m.trim().toLowerCase())

  const supportsStreaming =
    architecture?.output_modalities?.includes('text') ?? false
  const supportsVision = inputModalities.some((m: string) =>
    m.includes('image')
  )

  return { supportsTools, supportsStreaming, supportsVision }
}

/**
 * Filter models to those whose provider has a key configured.
 * If no provider is configured at all, return the full list so the dev UI
 * is not empty.
 */
function filterByConfiguredProviders(
  models: ModelCapability[]
): ModelCapability[] {
  const filtered = models.filter((m) => isProviderConfigured(m.provider))
  return filtered.length > 0 ? filtered : models
}

function buildStaticModels(): ModelCapability[] {
  const registry = getModelRegistry()
  const full: ModelCapability[] = []

  for (const entry of registry) {
    for (const provider of entry.providers) {
      const id = `${provider}:${entry.id}`
      const isFree = isFreeAgentModel(entry.id)

      full.push({
        id,
        modelId: entry.id,
        provider,
        name: entry.id,
        description: entry.description,
        contextLength: entry.contextLength,
        formattedContextLength: formatCompactNumber(entry.contextLength),
        isFree,
        available: isProviderConfigured(provider),
        pricing: entry.pricing,
      })
    }
  }

  return filterByConfiguredProviders(full)
}

async function buildModels(): Promise<ModelCapability[]> {
  let orCapabilities: Map<string, Record<string, unknown>> | undefined

  try {
    orCapabilities = await fetchOpenRouterCapabilities()
  } catch {
    // OpenRouter API unavailable — return static metadata only
  }

  const registry = getModelRegistry()
  const full: ModelCapability[] = []

  for (const entry of registry) {
    for (const provider of entry.providers) {
      const id = `${provider}:${entry.id}`
      const isFree = isFreeAgentModel(entry.id)
      const orData = orCapabilities?.get(entry.id)

      // Enrich context length from OpenRouter if available
      const contextLength =
        (orData?.contextLength as number | undefined) ?? entry.contextLength
      const maxOutputTokens = orData?.maxOutputTokens as number | undefined

      const capabilities = extractCapabilities(orData)

      full.push({
        id,
        modelId: entry.id,
        provider,
        name: entry.id,
        description: entry.description,
        contextLength,
        formattedContextLength: formatCompactNumber(contextLength),
        ...(maxOutputTokens
          ? {
              maxOutputTokens,
              formattedMaxOutputTokens: formatCompactNumber(maxOutputTokens),
            }
          : {}),
        isFree,
        available: isProviderConfigured(provider),
        pricing: entry.pricing,
        ...capabilities,
      })
    }
  }

  return filterByConfiguredProviders(full)
}

function getConfiguredProviders(): string[] {
  return Object.keys(PROVIDERS).filter((id) => isProviderConfigured(id))
}

async function handleGet(request: Request): Promise<Response> {
  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  const configuredProviders = getConfiguredProviders()

  try {
    const models = await buildModels()
    return Response.json({ models, configuredProviders })
  } catch (error) {
    console.error('Failed to build models:', error)
    return Response.json(
      {
        error: 'Failed to fetch model capabilities',
        models: buildStaticModels(),
        configuredProviders,
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/v1/agents/models')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})
