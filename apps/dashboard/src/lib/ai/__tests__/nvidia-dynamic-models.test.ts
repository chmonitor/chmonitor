/**
 * Unit tests for the NVIDIA NIM dynamic catalog: allowlist gating, the
 * floor-preserving merge, and the fail-soft paths. Fixtures mirror the real
 * `integrate.api.nvidia.com/v1/models` shape (ids only — no pricing, no
 * context, no capability flags). No live network: `fetch` is mocked.
 */

import {
  __resetNvidiaDynamicCachesForTests,
  buildNvidiaDynamicModels,
  DEFAULT_NVIDIA_CONTEXT_LENGTH,
  DEFAULT_NVIDIA_TOP_N,
  fetchNvidiaCatalog,
  isNvidiaDynamicEnabled,
  isNvidiaToolCapable,
  loadNvidiaDynamicModelEntries,
  mergeNvidiaDynamicModels,
  NVIDIA_DYNAMIC_CACHE_TTL_MS,
  NVIDIA_TOOL_CAPABLE_MODEL_IDS,
  type NvidiaCatalogModel,
  rankNvidiaModels,
} from '../nvidia-dynamic-models'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const savedEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

/** Minimal catalog payload, as returned upstream. */
function catalogOf(ids: string[]): { data: NvidiaCatalogModel[] } {
  return {
    data: ids.map((id) => ({
      id,
      object: 'model',
      created: 735_790_403,
      owned_by: id.split('/')[0] ?? 'nvidia',
    })),
  }
}

beforeEach(() => {
  __resetNvidiaDynamicCachesForTests()
  setEnv({ NVIDIA_API_KEY: 'test-key', NVIDIA_TOP_MODELS_N: undefined })
})

afterEach(() => {
  process.env = { ...savedEnv }
  __resetNvidiaDynamicCachesForTests()
})

describe('isNvidiaToolCapable', () => {
  test('true for a curated allowlist id', () => {
    expect(
      isNvidiaToolCapable({ id: NVIDIA_TOOL_CAPABLE_MODEL_IDS[0] })
    ).toBe(true)
  })

  test('false for a catalog model outside the allowlist', () => {
    // Real catalog id, but no published evidence it drives the tool loop.
    expect(
      isNvidiaToolCapable({ id: 'mistralai/mistral-large-2-instruct' })
    ).toBe(false)
  })

  test('false for an id no provider lists', () => {
    expect(isNvidiaToolCapable({ id: 'not-a-real/model' })).toBe(false)
  })
})

describe('rankNvidiaModels', () => {
  test('excludes catalog models outside the allowlist', () => {
    const catalog = [
      { id: 'google/codegemma-7b' },
      { id: NVIDIA_TOOL_CAPABLE_MODEL_IDS[0] },
    ]
    const ranked = rankNvidiaModels(catalog)
    expect(ranked.map((r) => r.modelId)).toEqual([
      NVIDIA_TOOL_CAPABLE_MODEL_IDS[0],
    ])
  })

  test('honours allowlist order', () => {
    const strongest = NVIDIA_TOOL_CAPABLE_MODEL_IDS[0]
    const next = NVIDIA_TOOL_CAPABLE_MODEL_IDS[1]
    const ranked = rankNvidiaModels([{ id: next }, { id: strongest }])
    expect(ranked.map((r) => r.modelId)).toEqual([strongest, next])
  })

  test('puts curated registry entries ahead of the rest', () => {
    // The registry's NVIDIA floor is the best-known model; it must lead even
    // though the allowlist ranks it last.
    const curated = 'nvidia/llama-3.1-nemotron-70b-instruct'
    const ranked = rankNvidiaModels([
      { id: curated },
      { id: 'openai/gpt-oss-20b' },
    ])
    expect(ranked[0]?.modelId).toBe(curated)
  })

  test('applies the limit', () => {
    const ranked = rankNvidiaModels(
      NVIDIA_TOOL_CAPABLE_MODEL_IDS.map((id) => ({ id })),
      { limit: 3 }
    )
    expect(ranked).toHaveLength(3)
  })

  test('is stable across calls (id tiebreak)', () => {
    const catalog = [...NVIDIA_TOOL_CAPABLE_MODEL_IDS]
      .reverse()
      .map((id) => ({ id }))
    expect(rankNvidiaModels(catalog).map((r) => r.modelId)).toEqual(
      rankNvidiaModels(catalog).map((r) => r.modelId)
    )
  })

  test('reports the default context when the catalog has none', () => {
    // The NIM catalog publishes no context length — we must not invent one.
    const ranked = rankNvidiaModels([{ id: 'openai/gpt-oss-20b' }])
    expect(ranked[0]?.contextLength).toBe(DEFAULT_NVIDIA_CONTEXT_LENGTH)
  })
})

describe('mergeNvidiaDynamicModels', () => {
  const base = [{ id: 'nvidia:curated-a' }, { id: 'nvidia:curated-b' }]

  test('keeps every curated entry', () => {
    const merged = mergeNvidiaDynamicModels(base, [
      { id: 'nvidia:dynamic-1' },
    ])
    expect(merged.map((m) => m.id)).toEqual([
      'nvidia:curated-a',
      'nvidia:curated-b',
      'nvidia:dynamic-1',
    ])
  })

  test('curated entry wins on id collision', () => {
    const merged = mergeNvidiaDynamicModels(
      [{ id: 'nvidia:dup', description: 'curated' }],
      [{ id: 'nvidia:dup', description: 'dynamic' }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.description).toBe('curated')
  })

  test('empty dynamic list leaves the floor untouched', () => {
    expect(mergeNvidiaDynamicModels(base, [])).toEqual(base)
  })
})

describe('fetchNvidiaCatalog', () => {
  test('parses the data array', async () => {
    const fetchImpl = async () => okResponse(catalogOf(['openai/gpt-oss-20b']))
    const catalog = await fetchNvidiaCatalog(fetchImpl as typeof fetch)
    expect(catalog.map((m) => m.id)).toEqual(['openai/gpt-oss-20b'])
  })

  test('returns [] on a non-ok response', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 })
    expect(await fetchNvidiaCatalog(fetchImpl as typeof fetch)).toEqual([])
  })

  test('returns [] when the request throws', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }
    expect(await fetchNvidiaCatalog(fetchImpl as typeof fetch)).toEqual([])
  })

  test('returns [] on a malformed body', async () => {
    const fetchImpl = async () => okResponse({ data: 'not-an-array' })
    expect(await fetchNvidiaCatalog(fetchImpl as typeof fetch)).toEqual([])
  })
})

describe('buildNvidiaDynamicModels', () => {
  test('maps ranked models to picker entries without pricing', async () => {
    // The NIM catalog has no rates; the entry must omit cost rather than guess.
    const fetchImpl = async () =>
      okResponse(catalogOf(['nvidia/nemotron-3-super-120b-a12b']))
    const entries = await buildNvidiaDynamicModels({
      fetchImpl: fetchImpl as typeof fetch,
      forceRefresh: true,
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('nvidia:nvidia/nemotron-3-super-120b-a12b')
    expect(entries[0]?.provider).toBe('nvidia')
    expect(entries[0]?.pricing).toBeUndefined()
    expect(entries[0]?.supportsTools).toBe(true)
    expect(entries[0]?.dynamic).toBe(true)
    expect(entries[0]?.available).toBe(true)
  })

  test('returns [] when the catalog is unreachable', async () => {
    const fetchImpl = async () => {
      throw new Error('upstream down')
    }
    expect(
      await buildNvidiaDynamicModels({
        fetchImpl: fetchImpl as typeof fetch,
        forceRefresh: true,
      })
    ).toEqual([])
  })

  test('caches the catalog within the TTL', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return okResponse(catalogOf(['openai/gpt-oss-20b']))
    }
    const opts = { fetchImpl: fetchImpl as typeof fetch }

    await buildNvidiaDynamicModels(opts)
    await buildNvidiaDynamicModels(opts)

    expect(calls).toBe(1)
    expect(NVIDIA_DYNAMIC_CACHE_TTL_MS).toBeGreaterThan(0)
  })

  test('respects the top-N knob', async () => {
    const fetchImpl = async () =>
      okResponse(catalogOf([...NVIDIA_TOOL_CAPABLE_MODEL_IDS]))
    const entries = await buildNvidiaDynamicModels({
      fetchImpl: fetchImpl as typeof fetch,
      topN: 2,
      forceRefresh: true,
    })
    expect(entries).toHaveLength(2)
  })

  test('defaults to DEFAULT_NVIDIA_TOP_N when unset', () => {
    setEnv({ NVIDIA_TOP_MODELS_N: undefined })
    expect(DEFAULT_NVIDIA_TOP_N).toBeGreaterThan(0)
  })
})

describe('isNvidiaDynamicEnabled', () => {
  test('true when NVIDIA_API_KEY is set', () => {
    setEnv({ NVIDIA_API_KEY: 'k' })
    expect(isNvidiaDynamicEnabled()).toBe(true)
  })

  test('false when NVIDIA_API_KEY is missing (fail-closed)', () => {
    setEnv({ NVIDIA_API_KEY: undefined, LLM_API_KEY: undefined })
    expect(isNvidiaDynamicEnabled()).toBe(false)
  })

  test('false when the kill-switch is set', () => {
    setEnv({ NVIDIA_API_KEY: 'k', NVIDIA_DYNAMIC_MODELS: 'false' })
    expect(isNvidiaDynamicEnabled()).toBe(false)
  })
})

describe('loadNvidiaDynamicModelEntries', () => {
  test('returns [] when the provider is not configured', async () => {
    setEnv({ NVIDIA_API_KEY: undefined, LLM_API_KEY: undefined })
    expect(await loadNvidiaDynamicModelEntries()).toEqual([])
  })

  test('returns [] instead of throwing when discovery fails', async () => {
    setEnv({ NVIDIA_API_KEY: 'k' })
    const fetchImpl = async () => {
      throw new Error('upstream down')
    }
    const entries = await loadNvidiaDynamicModelEntries({
      fetchImpl: fetchImpl as typeof fetch,
      forceRefresh: true,
    })
    expect(entries).toEqual([])
  })

  test('returns entries when discovery succeeds', async () => {
    setEnv({ NVIDIA_API_KEY: 'k' })
    const fetchImpl = async () =>
      okResponse(catalogOf(['nvidia/nemotron-3-super-120b-a12b']))
    const entries = await loadNvidiaDynamicModelEntries({
      fetchImpl: fetchImpl as typeof fetch,
      forceRefresh: true,
    })
    expect(entries.map((e) => e.id)).toEqual([
      'nvidia:nvidia/nemotron-3-super-120b-a12b',
    ])
  })
})
