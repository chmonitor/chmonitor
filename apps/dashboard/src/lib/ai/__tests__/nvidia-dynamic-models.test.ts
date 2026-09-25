/**
 * Unit tests for the NVIDIA dynamic model loader.
 *
 * The catalog stub mirrors the real 2026-09-26 `GET {NVIDIA_API_BASE}/models`
 * shape: `{ object: 'list', data: [{ id, object, created, owned_by }] }` with a
 * CONSTANT `created`, no `context_length`, no `pricing`, and no
 * `supported_parameters`. Those absences are the whole point of this module, so
 * the stub reproduces them rather than an idealized catalog.
 */

import {
  __resetNvidiaDynamicCachesForTests,
  buildNvidiaDynamicModels,
  DEFAULT_NVIDIA_TOP_N,
  fetchNvidiaCatalog,
  hasAgenticNvidiaHint,
  isExcludedNvidiaModel,
  isNvidiaDynamicEnabled,
  loadNvidiaDynamicModelEntries,
  mergeNvidiaDynamicModels,
  NVIDIA_DEFAULT_CONTEXT_LENGTH,
  type NvidiaCatalogModel,
  nvidiaModelsUrl,
  rankNvidiaModels,
} from '../nvidia-dynamic-models'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/** Ids taken verbatim from the live catalog, mixing chat and non-chat. */
const CATALOG: NvidiaCatalogModel[] = [
  // Chat / agent-grade.
  {
    id: 'nvidia/nemotron-4-340b-instruct',
    object: 'model',
    created: 735790403,
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    object: 'model',
    created: 735790403,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    object: 'model',
    created: 735790403,
  },
  {
    id: 'deepseek-ai/deepseek-v4.1-flash',
    object: 'model',
    created: 735790403,
  },
  { id: 'z-ai/glm-5.3-flash', object: 'model', created: 735790403 },
  {
    id: 'mistralai/mistral-large-2-instruct',
    object: 'model',
    created: 735790403,
  },
  // Provably not chat.
  { id: 'nvidia/embed-qa-4', object: 'model', created: 735790403 },
  { id: 'snowflake/arctic-embed-l', object: 'model', created: 735790403 },
  {
    id: 'nvidia/llama-3.1-nemoguard-8b-content-safety',
    object: 'model',
    created: 735790403,
  },
  {
    id: 'nvidia/nemotron-3.5-content-safety',
    object: 'model',
    created: 735790403,
  },
  { id: 'nvidia/nemotron-parse', object: 'model', created: 735790403 },
  { id: 'nvidia/nemotron-4-340b-reward', object: 'model', created: 735790403 },
  { id: 'nvidia/nvclip', object: 'model', created: 735790403 },
  { id: 'google/deplot', object: 'model', created: 735790403 },
  { id: 'meta/codellama-70b', object: 'model', created: 735790403 },
  { id: 'bigcode/starcoder2-15b', object: 'model', created: 735790403 },
  { id: 'nvidia/nvidia-nv-embedqa-1b-v1', object: 'model', created: 735790403 },
]

function jsonFetch(body: unknown, ok = true) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

const savedEnv: Record<string, string | undefined> = {}
function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  __resetNvidiaDynamicCachesForTests()
})

afterEach(() => {
  __resetNvidiaDynamicCachesForTests()
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k]
})

describe('isNvidiaDynamicEnabled', () => {
  test('is fail-closed without NVIDIA_API_KEY, even though the catalog is public', () => {
    setEnv({ NVIDIA_API_KEY: undefined, NVIDIA_DYNAMIC_MODELS: undefined })
    expect(isNvidiaDynamicEnabled()).toBe(false)
  })

  test('is enabled once NVIDIA_API_KEY is set', () => {
    setEnv({ NVIDIA_API_KEY: 'nv-test' })
    expect(isNvidiaDynamicEnabled()).toBe(true)
  })

  test('honors the kill-switch', () => {
    setEnv({ NVIDIA_API_KEY: 'nv-test' })
    for (const off of ['false', '0', 'off', 'no', 'NO']) {
      setEnv({ NVIDIA_DYNAMIC_MODELS: off })
      expect(isNvidiaDynamicEnabled()).toBe(false)
    }
    setEnv({ NVIDIA_DYNAMIC_MODELS: 'true' })
    expect(isNvidiaDynamicEnabled()).toBe(true)
  })
})

describe('nvidiaModelsUrl', () => {
  test('defaults to the public NIM endpoint', () => {
    setEnv({ NVIDIA_API_BASE: undefined })
    expect(nvidiaModelsUrl()).toBe('https://integrate.api.nvidia.com/v1/models')
  })

  test('follows NVIDIA_API_BASE and strips a trailing slash', () => {
    setEnv({ NVIDIA_API_BASE: 'https://nim.internal/v1/' })
    expect(nvidiaModelsUrl()).toBe('https://nim.internal/v1/models')
  })
})

describe('fetchNvidiaCatalog', () => {
  test('returns the data array on success', async () => {
    const catalog = await fetchNvidiaCatalog(
      jsonFetch({ object: 'list', data: CATALOG })
    )
    expect(catalog).toHaveLength(CATALOG.length)
  })

  test('is fail-soft on a non-ok response', async () => {
    expect(await fetchNvidiaCatalog(jsonFetch({}, false))).toEqual([])
  })

  test('is fail-soft on a network throw', async () => {
    const boom = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await fetchNvidiaCatalog(boom)).toEqual([])
  })

  test('is fail-soft on a malformed body', async () => {
    expect(await fetchNvidiaCatalog(jsonFetch({ data: 'nope' }))).toEqual([])
  })

  test('sends the API key when set, so a self-hosted NIM behind auth works', async () => {
    setEnv({ NVIDIA_API_KEY: 'nv-secret' })
    let seen: string | null = null
    await fetchNvidiaCatalog((async (_url: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers).get('Authorization')
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch)
    expect(seen).toBe('Bearer nv-secret')
  })
})

describe('isExcludedNvidiaModel', () => {
  test('drops the non-chat categories present in the real catalog', () => {
    for (const id of [
      'nvidia/embed-qa-4',
      'snowflake/arctic-embed-l',
      'nvidia/nvidia-nv-embedqa-1b-v1',
      'nvidia/llama-3.1-nemoguard-8b-content-safety',
      'nvidia/nemotron-3.5-content-safety',
      'nvidia/nemotron-parse',
      'nvidia/nemotron-4-340b-reward',
      'nvidia/nvclip',
      'google/deplot',
      'meta/codellama-70b',
      'bigcode/starcoder2-15b',
    ]) {
      expect(isExcludedNvidiaModel(id)).toBe(true)
    }
  })

  test('keeps the chat / agent-grade models', () => {
    for (const id of [
      'nvidia/nemotron-4-340b-instruct',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'deepseek-ai/deepseek-v4.1-flash',
      'z-ai/glm-5.3-flash',
      'mistralai/mistral-large-2-instruct',
      'moonshotai/kimi-k3',
      'qwen/qwen3.5-397b-a17b',
    ]) {
      expect(isExcludedNvidiaModel(id)).toBe(false)
    }
  })

  test('does not drop a chat model merely because it mentions code', () => {
    expect(isExcludedNvidiaModel('qwen/qwen3-coder')).toBe(false)
    expect(isExcludedNvidiaModel('ibm/granite-34b-code-instruct')).toBe(false)
  })
})

describe('hasAgenticNvidiaHint', () => {
  test('matches chat/instruct/reasoning markers', () => {
    for (const id of [
      'nvidia/nemotron-4-340b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/mistral-nemo-minitron-8b-8k-instruct',
      'google/gemma-4-31b-it',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'nvidia/llama3-chatqa-1.5-70b',
    ]) {
      expect(hasAgenticNvidiaHint(id)).toBe(true)
    }
  })

  test('a name with no marker still surfaces via the curated-registry bonus', () => {
    // `z-ai/glm-5.3` carries no instruct/chat/reason token, so the hint alone
    // would not carry it — the curated registry does. Both are additive
    // signals, neither is a filter.
    expect(hasAgenticNvidiaHint('z-ai/glm-5.3')).toBe(false)
    const ranked = rankNvidiaModels([{ id: 'z-ai/glm-5.3' }])
    expect(ranked.map((r) => r.modelId)).toEqual(['z-ai/glm-5.3'])
  })
})

describe('rankNvidiaModels', () => {
  test('excludes non-chat entries and ranks curated registry ids first', () => {
    const ranked = rankNvidiaModels(CATALOG)
    const ids = ranked.map((r) => r.modelId)

    // The curated registry contains these three, so they lead the ranking.
    expect(ids.slice(0, 3).sort()).toEqual([
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-4-340b-instruct',
    ])

    for (const excluded of CATALOG.map((c) => c.id)) {
      if (isExcludedNvidiaModel(excluded)) {
        expect(ids).not.toContain(excluded)
      }
    }
  })

  test('falls back to a documented context length and claims no pricing', () => {
    const ranked = rankNvidiaModels(CATALOG)
    for (const r of ranked) {
      expect(r.contextLength).toBe(NVIDIA_DEFAULT_CONTEXT_LENGTH)
      expect(r.pricing).toBeUndefined()
      expect(r.isFree).toBe(true)
      // Tool support is unknown on this catalog, never asserted.
      expect(r.supportsTools).toBe(false)
    }
  })

  test('uses a context length when a proxying catalog supplies one', () => {
    const ranked = rankNvidiaModels([
      { id: 'nvidia/nemotron-3-ultra-550b-a55b', context_length: 1_000_000 },
    ])
    expect(ranked[0].contextLength).toBe(1_000_000)
  })

  test('reads a per-token rate when a proxying catalog supplies one', () => {
    const ranked = rankNvidiaModels([
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b',
        pricing: { prompt: '0.0000006', completion: '0.0000024' },
      },
    ])
    expect(ranked[0].pricing).toEqual({
      inputPerMillion: 0.6,
      outputPerMillion: 2.4,
    })
  })

  test('breaks ties by id so output is stable', () => {
    const a = rankNvidiaModels([
      { id: 'zzz/aaa-instruct' },
      { id: 'aaa/zzz-instruct' },
    ])
    const b = rankNvidiaModels([
      { id: 'aaa/zzz-instruct' },
      { id: 'zzz/aaa-instruct' },
    ])
    expect(a.map((r) => r.modelId)).toEqual(b.map((r) => r.modelId))
  })

  test('respects the limit', () => {
    const ranked = rankNvidiaModels(CATALOG, { limit: 2 })
    expect(ranked).toHaveLength(2)
  })

  test('ignores the constant `created` field entirely', () => {
    // Both entries carry the real catalog's constant timestamp; only the
    // curated/agentic signals may separate them.
    const ranked = rankNvidiaModels([
      { id: 'unknownvendor/aaa', created: 735790403 },
      { id: 'nvidia/nemotron-4-340b-instruct', created: 735790403 },
    ])
    expect(ranked[0].modelId).toBe('nvidia/nemotron-4-340b-instruct')
  })
})

describe('mergeNvidiaDynamicModels', () => {
  test('keeps every base entry (floor-preserving) and appends only new ids', () => {
    const base = [
      { id: 'nvidia:nvidia/nemotron-4-340b-instruct' },
      { id: 'nvidia:nvidia/llama-3.1-nemotron-70b-instruct' },
    ]
    const dynamic = [
      { id: 'nvidia:nvidia/nemotron-4-340b-instruct' }, // already curated
      { id: 'nvidia:z-ai/glm-5.3-flash' }, // new
    ]
    const merged = mergeNvidiaDynamicModels(base, dynamic)
    expect(merged.map((m) => m.id)).toEqual([
      'nvidia:nvidia/nemotron-4-340b-instruct',
      'nvidia:nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia:z-ai/glm-5.3-flash',
    ])
  })

  test('returns the base untouched when discovery found nothing', () => {
    const base = [{ id: 'nvidia:a' }, { id: 'nvidia:b' }]
    expect(mergeNvidiaDynamicModels(base, [])).toEqual(base)
  })
})

describe('buildNvidiaDynamicModels / loadNvidiaDynamicModelEntries', () => {
  test('maps ranked entries to picker entries with the nvidia prefix', async () => {
    const entries = await buildNvidiaDynamicModels({
      fetchImpl: jsonFetch({ object: 'list', data: CATALOG }),
      topN: 3,
      forceRefresh: true,
    })
    expect(entries).toHaveLength(3)
    for (const e of entries) {
      expect(e.provider).toBe('nvidia')
      expect(e.id).toBe(`nvidia:${e.modelId}`)
      expect(e.dynamic).toBe(true)
      expect(e.formattedContextLength).toBeTruthy()
    }
  })

  test('honors NVIDIA_TOP_MODELS_N', async () => {
    setEnv({ NVIDIA_TOP_MODELS_N: '4' })
    const entries = await buildNvidiaDynamicModels({
      fetchImpl: jsonFetch({ object: 'list', data: CATALOG }),
      forceRefresh: true,
    })
    expect(entries).toHaveLength(4)
  })

  test('clamps a nonsense NVIDIA_TOP_MODELS_N to the default', async () => {
    for (const bad of ['0', '-3', 'abc']) {
      __resetNvidiaDynamicCachesForTests()
      setEnv({ NVIDIA_TOP_MODELS_N: bad })
      const entries = await buildNvidiaDynamicModels({
        fetchImpl: jsonFetch({ object: 'list', data: CATALOG }),
        forceRefresh: true,
      })
      expect(entries.length).toBeLessThanOrEqual(DEFAULT_NVIDIA_TOP_N)
      expect(entries.length).toBeGreaterThan(0)
    }
  })

  test('returns [] (never throws) when the upstream is unreachable', async () => {
    const boom = (async () => {
      throw new Error('upstream down')
    }) as unknown as typeof fetch
    expect(await loadNvidiaDynamicModelEntries({ fetchImpl: boom })).toEqual([])
  })

  test('returns [] when disabled and no fetchImpl is injected', async () => {
    setEnv({ NVIDIA_API_KEY: undefined })
    expect(await loadNvidiaDynamicModelEntries()).toEqual([])
  })
})
