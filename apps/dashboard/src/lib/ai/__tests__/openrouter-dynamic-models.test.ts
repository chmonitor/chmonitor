/**
 * Unit tests for OpenRouter dynamic catalog ranking + fail-soft merge.
 * Fixtures mirror the public openrouter.ai/api/v1/models contract. No live
 * network — `fetch` is mocked via `fetchImpl`.
 */

import {
  __resetOpenRouterDynamicCachesForTests,
  buildOpenRouterDynamicModels,
  DEFAULT_OPENROUTER_TOP_N,
  fetchOpenRouterCatalog,
  isOpenRouterDynamicEnabled,
  isOpenRouterToolCapable,
  loadOpenRouterDynamicModelEntries,
  mergeOpenRouterDynamicModels,
  OPENROUTER_DYNAMIC_CACHE_TTL_MS,
  type OpenRouterCatalogModel,
  rankOpenRouterModels,
} from '../openrouter-dynamic-models'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function model(
  partial: Partial<OpenRouterCatalogModel> & { id: string }
): OpenRouterCatalogModel {
  return {
    name: partial.id,
    context_length: 128_000,
    supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    created: 1_700_000_000,
    ...partial,
  }
}

const NOW = 1_755_000_000_000 // fixed "now" for deterministic recency scoring

describe('isOpenRouterToolCapable', () => {
  test('true when supported_parameters includes tools', () => {
    expect(isOpenRouterToolCapable(model({ id: 'a/a' }))).toBe(true)
  })

  test('true when supported_parameters includes tool_choice only', () => {
    expect(
      isOpenRouterToolCapable(
        model({ id: 'a/a', supported_parameters: ['tool_choice'] })
      )
    ).toBe(true)
  })

  test('false when no tool-related supported_parameters', () => {
    expect(
      isOpenRouterToolCapable(
        model({ id: 'a/a', supported_parameters: ['max_tokens'] })
      )
    ).toBe(false)
  })
})

describe('rankOpenRouterModels', () => {
  test('excludes models without tool support', () => {
    const catalog = [
      model({ id: 'no/tools', supported_parameters: ['max_tokens'] }),
      model({ id: 'has/tools' }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked.map((r) => r.modelId)).toEqual(['has/tools'])
  })

  test('excludes non-text-output models', () => {
    const catalog = [
      model({
        id: 'image/only',
        architecture: { output_modalities: ['image'] },
      }),
      model({ id: 'text/model' }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked.map((r) => r.modelId)).toEqual(['text/model'])
  })

  test('curated MODEL_REGISTRY models rank above non-curated ones', () => {
    // anthropic/claude-sonnet-4.5 is in MODEL_REGISTRY under 'openrouter'.
    const catalog = [
      model({ id: 'some/obscure-model' }),
      model({ id: 'anthropic/claude-sonnet-4.5' }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked[0]?.modelId).toBe('anthropic/claude-sonnet-4.5')
  })

  test('preferred-author models rank above unknown authors, all else equal', () => {
    const catalog = [
      model({ id: 'unknown-author/model-a' }),
      model({ id: 'openai/model-b' }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked[0]?.modelId).toBe('openai/model-b')
  })

  test('free variants get a bonus over an otherwise-identical paid model', () => {
    const catalog = [
      model({ id: 'vendor/paid-model' }),
      model({
        id: 'vendor/free-model:free',
        pricing: { prompt: '0', completion: '0' },
      }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked[0]?.modelId).toBe('vendor/free-model:free')
    expect(ranked[0]?.isFree).toBe(true)
  })

  test('is deterministic and ties break by id ascending', () => {
    const catalog = [
      model({ id: 'zzz/model', created: undefined, context_length: 0 }),
      model({ id: 'aaa/model', created: undefined, context_length: 0 }),
    ]
    const first = rankOpenRouterModels(catalog, { now: NOW })
    const second = rankOpenRouterModels(catalog, { now: NOW })
    expect(first.map((r) => r.modelId)).toEqual(second.map((r) => r.modelId))
    expect(first.map((r) => r.modelId)).toEqual(['aaa/model', 'zzz/model'])
  })

  test('limit clamps the ranked output', () => {
    const catalog = Array.from({ length: 5 }, (_, i) =>
      model({ id: `vendor/model-${i}` })
    )
    const ranked = rankOpenRouterModels(catalog, { now: NOW, limit: 2 })
    expect(ranked).toHaveLength(2)
  })

  test('converts per-token pricing to per-million', () => {
    const catalog = [
      model({
        id: 'vendor/priced-model',
        pricing: { prompt: '0.000001', completion: '0.000003' },
      }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked[0]?.pricing).toEqual({
      inputPerMillion: 1,
      outputPerMillion: 3,
    })
  })

  test('omits pricing entirely for free models', () => {
    const catalog = [
      model({
        id: 'vendor/free-model',
        pricing: { prompt: '0', completion: '0' },
      }),
    ]
    const ranked = rankOpenRouterModels(catalog, { now: NOW })
    expect(ranked[0]?.pricing).toBeUndefined()
    expect(ranked[0]?.isFree).toBe(true)
  })
})

describe('mergeOpenRouterDynamicModels', () => {
  test('keeps all base entries even when dynamic has a duplicate id', () => {
    const base = [
      { id: 'openrouter:anthropic/claude-sonnet-4.5', name: 'curated' },
    ]
    const dynamic = [
      { id: 'openrouter:anthropic/claude-sonnet-4.5', name: 'dynamic-dupe' },
      { id: 'openrouter:new/model', name: 'dynamic-only' },
    ]
    const merged = mergeOpenRouterDynamicModels(base, dynamic)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual(base[0])
    expect(merged.map((m) => m.id)).toContain('openrouter:new/model')
  })

  test('base-only and dynamic-only inputs both work', () => {
    expect(mergeOpenRouterDynamicModels([{ id: 'a' }], [])).toEqual([
      { id: 'a' },
    ])
    expect(mergeOpenRouterDynamicModels([], [{ id: 'b' }])).toEqual([
      { id: 'b' },
    ])
  })
})

describe('fetchOpenRouterCatalog', () => {
  test('returns [] on non-ok response', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch
    expect(await fetchOpenRouterCatalog(fetchImpl)).toEqual([])
  })

  test('returns [] on network failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await fetchOpenRouterCatalog(fetchImpl)).toEqual([])
  })

  test('parses data array from a successful response', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [model({ id: 'vendor/model' })] }), {
        status: 200,
      })) as unknown as typeof fetch
    const catalog = await fetchOpenRouterCatalog(fetchImpl)
    expect(catalog).toHaveLength(1)
    expect(catalog[0]?.id).toBe('vendor/model')
  })
})

describe('isOpenRouterDynamicEnabled', () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  const originalFlag = process.env.OPENROUTER_DYNAMIC_MODELS

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
    if (originalFlag === undefined) delete process.env.OPENROUTER_DYNAMIC_MODELS
    else process.env.OPENROUTER_DYNAMIC_MODELS = originalFlag
  })

  test('disabled when provider is not configured', () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.LLM_API_KEY
    process.env.OPENROUTER_DYNAMIC_MODELS = ''
    expect(isOpenRouterDynamicEnabled()).toBe(false)
  })

  test('disabled by kill switch even when configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_DYNAMIC_MODELS = 'false'
    expect(isOpenRouterDynamicEnabled()).toBe(false)
  })
})

describe('buildOpenRouterDynamicModels / loadOpenRouterDynamicModelEntries', () => {
  beforeEach(() => {
    __resetOpenRouterDynamicCachesForTests()
  })

  afterEach(() => {
    __resetOpenRouterDynamicCachesForTests()
  })

  test('build maps ranked catalog entries to AgentModelListEntry', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(
        JSON.stringify({ data: [model({ id: 'vendor/model' })] }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const entries = await buildOpenRouterDynamicModels({
      fetchImpl,
      now: NOW,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'openrouter:vendor/model',
      provider: 'openrouter',
      dynamic: true,
    })
    expect(calls).toBe(1)
  })

  test('topN clamps the number of entries returned', async () => {
    const catalog = Array.from({ length: 40 }, (_, i) =>
      model({ id: `vendor/model-${i}` })
    )
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: catalog }), {
        status: 200,
      })) as unknown as typeof fetch

    const defaultEntries = await buildOpenRouterDynamicModels({
      fetchImpl,
      now: NOW,
    })
    expect(defaultEntries).toHaveLength(DEFAULT_OPENROUTER_TOP_N)

    __resetOpenRouterDynamicCachesForTests()
    const custom = await buildOpenRouterDynamicModels({
      fetchImpl,
      now: NOW,
      topN: 3,
    })
    expect(custom).toHaveLength(3)
  })

  test('load returns [] when disabled (no fetchImpl override)', async () => {
    const originalKey = process.env.OPENROUTER_API_KEY
    const originalLlmKey = process.env.LLM_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.LLM_API_KEY
    try {
      const entries = await loadOpenRouterDynamicModelEntries()
      expect(entries).toEqual([])
    } finally {
      if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalKey
      if (originalLlmKey === undefined) delete process.env.LLM_API_KEY
      else process.env.LLM_API_KEY = originalLlmKey
    }
  })

  test('load returns [] on fetch failure (fail-soft)', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const entries = await loadOpenRouterDynamicModelEntries({ fetchImpl })
    expect(entries).toEqual([])
  })

  test('cache TTL reuses the catalog without refetching within the window', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(
        JSON.stringify({ data: [model({ id: 'vendor/model' })] }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const first = await loadOpenRouterDynamicModelEntries({ fetchImpl })
    const second = await loadOpenRouterDynamicModelEntries({ fetchImpl })
    expect(first).toEqual(second)
    expect(calls).toBe(1)
  })

  test('OPENROUTER_DYNAMIC_CACHE_TTL_MS matches the documented 5-minute window', () => {
    expect(OPENROUTER_DYNAMIC_CACHE_TTL_MS).toBe(300_000)
  })
})
