/**
 * Route tests for GET /api/v1/agents/models merge/degradation contract.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let authorizeAgentApiRequest = mock(
  async (_request: Request) => null as Response | null
)
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: (request: Request) =>
    authorizeAgentApiRequest(request),
}))

let dynamicAnyRouter = [
  {
    id: 'anyrouter:claude-sonnet',
    modelId: 'claude-sonnet',
    provider: 'anyrouter',
    name: 'claude-sonnet',
    available: true,
  },
]
let dynamicOpenRouter = [
  {
    id: 'openrouter:dynamic-model',
    modelId: 'dynamic-model',
    provider: 'openrouter',
    name: 'dynamic-model',
    available: true,
  },
]
let anyRouterPresets = [
  {
    id: 'anyrouter:@preset/team-default',
    modelId: '@preset/team-default',
    provider: 'anyrouter',
    name: 'team-default',
    available: true,
  },
]

mock.module('@/lib/ai/agent-model-registry', () => ({
  getModelRegistry: () => [
    {
      id: 'gpt-4o-mini',
      providers: ['openrouter'],
      description: 'registry floor',
      contextLength: 128_000,
      pricing: {},
    },
  ],
  isFreeAgentModel: () => false,
}))

mock.module('@/lib/ai/anyrouter-dynamic-models', () => ({
  loadAnyRouterDynamicModelEntries: async () => dynamicAnyRouter,
  mergeAnyRouterDynamicModels: (base: unknown[], extra: unknown[]) => [
    ...base,
    ...extra,
  ],
}))

let openRouterThrows = false

mock.module('@/lib/ai/openrouter-dynamic-models', () => ({
  loadOpenRouterDynamicModelEntries: async () => {
    if (openRouterThrows) throw new Error('openrouter down')
    return dynamicOpenRouter
  },
  mergeOpenRouterDynamicModels: (base: unknown[], extra: unknown[]) => [
    ...base,
    ...extra,
  ],
}))

let dynamicNvidia = [
  {
    id: 'nvidia:nvidia/nemotron-3-super-120b-a12b',
    modelId: 'nvidia/nemotron-3-super-120b-a12b',
    provider: 'nvidia',
    name: 'nvidia/nemotron-3-super-120b-a12b',
    available: true,
  },
]
let nvidiaThrows = false

mock.module('@/lib/ai/nvidia-dynamic-models', () => ({
  loadNvidiaDynamicModelEntries: async () => {
    if (nvidiaThrows) throw new Error('nvidia down')
    return dynamicNvidia
  },
  mergeNvidiaDynamicModels: (base: unknown[], extra: unknown[]) => [
    ...base,
    ...extra,
  ],
}))

mock.module('@/lib/ai/anyrouter-presets', () => ({
  loadAnyRouterPresetEntries: async () => anyRouterPresets,
  mergeAnyRouterPresets: (base: unknown[], extra: unknown[]) => [
    ...base,
    ...extra,
  ],
}))

let configuredProviders = ['openrouter', 'anyrouter']

mock.module('@/lib/ai/providers', () => ({
  getConfiguredProviderIds: () => configuredProviders,
  isProviderConfigured: (provider: string) =>
    configuredProviders.includes(provider),
}))

mock.module('@/lib/format-number', () => ({
  formatCompactNumber: (n: number) => String(n),
}))

globalThis.fetch = mock(async () => {
  throw new Error('OpenRouter API error: 503')
}) as typeof fetch

const { __handleGetForTests: handleGet } = await import('./models')

beforeEach(() => {
  authorizeAgentApiRequest = mock(async (_request: Request) => null)
  configuredProviders = ['openrouter', 'anyrouter']
  openRouterThrows = false
  nvidiaThrows = false
  dynamicNvidia = [
    {
      id: 'nvidia:nvidia/nemotron-3-super-120b-a12b',
      modelId: 'nvidia/nemotron-3-super-120b-a12b',
      provider: 'nvidia',
      name: 'nvidia/nemotron-3-super-120b-a12b',
      available: true,
    },
  ]
  dynamicAnyRouter = [
    {
      id: 'anyrouter:claude-sonnet',
      modelId: 'claude-sonnet',
      provider: 'anyrouter',
      name: 'claude-sonnet',
      available: true,
    },
  ]
  dynamicOpenRouter = [
    {
      id: 'openrouter:dynamic-model',
      modelId: 'dynamic-model',
      provider: 'openrouter',
      name: 'dynamic-model',
      available: true,
    },
  ]
  anyRouterPresets = [
    {
      id: 'anyrouter:@preset/team-default',
      modelId: '@preset/team-default',
      provider: 'anyrouter',
      name: 'team-default',
      available: true,
    },
  ]
})

describe('GET /api/v1/agents/models', () => {
  test('401 before loaders when auth rejects', async () => {
    authorizeAgentApiRequest = mock(async (_request: Request) =>
      Response.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(401)
  })

  test('still returns registry + AnyRouter when OpenRouter dynamic catalog is empty', async () => {
    dynamicOpenRouter = []
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    const ids = body.models.map((m) => m.id)
    expect(ids).toContain('openrouter:gpt-4o-mini')
    expect(ids).toContain('anyrouter:claude-sonnet')
    expect(ids).toContain('anyrouter:@preset/team-default')
    expect(ids).not.toContain('openrouter:dynamic-model')
  })

  test('returns static fallback when OpenRouter dynamic loader throws', async () => {
    openRouterThrows = true
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as {
      models: Array<{ id: string; provider: string }>
      error: string
    }
    expect(body.error).toContain('Failed to fetch model capabilities')
    expect(body.models.some((m) => m.id === 'openrouter:gpt-4o-mini')).toBe(
      true
    )
    expect(body.models.every((m) => m.provider === 'openrouter')).toBe(true)
  })

  test('strips models for providers that are not configured locally', async () => {
    configuredProviders = ['openrouter']
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ provider: string }> }
    expect(body.models.every((m) => m.provider === 'openrouter')).toBe(true)
  })

  test('merges presets after dynamic catalogs (last step wins ordering)', async () => {
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    const ids = body.models.map((m) => m.id)
    expect(ids.indexOf('anyrouter:claude-sonnet')).toBeLessThan(
      ids.indexOf('anyrouter:@preset/team-default')
    )
  })

  test('reports configuredProviders separately from catalog fetch success', async () => {
    dynamicOpenRouter = []
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    const body = (await res.json()) as { configuredProviders: string[] }
    expect(body.configuredProviders).toEqual(['openrouter', 'anyrouter'])
  })

  test('includes openrouter dynamic entries when loader succeeds', async () => {
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(body.models.some((m) => m.id === 'openrouter:dynamic-model')).toBe(
      true
    )
  })

  test('includes nvidia dynamic entries when loader succeeds', async () => {
    configuredProviders = ['openrouter', 'anyrouter', 'nvidia']
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(
      body.models.some(
        (m) => m.id === 'nvidia:nvidia/nemotron-3-super-120b-a12b'
      )
    ).toBe(true)
  })

  test('a nvidia-only deployment sees nvidia models and no others', async () => {
    configuredProviders = ['nvidia']
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      models: Array<{ id: string; provider: string }>
      configuredProviders: string[]
    }
    expect(body.configuredProviders).toEqual(['nvidia'])
    // Non-empty, or the provider filter would have emptied the picker and
    // `every` would still pass vacuously.
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.models.every((m) => m.provider === 'nvidia')).toBe(true)
    expect(
      body.models.some(
        (m) => m.id === 'nvidia:nvidia/nemotron-3-super-120b-a12b'
      )
    ).toBe(true)
    // The openrouter registry entry must not leak to an unconfigured provider.
    expect(body.models.some((m) => m.id === 'nvidia:gpt-4o-mini')).toBe(false)
  })

  test('returns the curated registry when every dynamic loader is empty', async () => {
    // Acceptance criterion: with all discovery endpoints unreachable the picker
    // still lists the curated floor rather than an empty catalog.
    dynamicAnyRouter = []
    dynamicOpenRouter = []
    dynamicNvidia = []
    anyRouterPresets = []
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(body.models.map((m) => m.id)).toContain('openrouter:gpt-4o-mini')
  })

  test('returns the curated registry when the nvidia loader throws', async () => {
    nvidiaThrows = true
    const res = await handleGet(
      new Request('https://dash.example.com/api/v1/agents/models')
    )
    // The 500 path still returns the static registry floor.
    expect(res.status).toBe(500)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(body.models.map((m) => m.id)).toContain('openrouter:gpt-4o-mini')
  })
})
