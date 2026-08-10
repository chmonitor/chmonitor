/**
 * Unit tests for AnyRouter dynamic catalog ranking + fail-soft merge.
 * Fixtures mirror the public anyrouter.dev contract (list item + metrics
 * request_count). No live network.
 */

import {
  __resetAnyRouterDynamicCachesForTests,
  ANYROUTER_AUTO_MODEL_ID,
  type AnyRouterModelListItem,
  buildAnyRouterAutoEntry,
  buildAnyRouterDynamicModels,
  extractPreferredRouters,
  isAgentToolCapable,
  isAnyRouterAutoModelId,
  isAnyRouterRouterAlias,
  loadAnyRouterDynamicModelEntries,
  mergeAnyRouterDynamicModels,
  pickTopUsageModelId,
  type RankInput,
  rankedToAgentModelEntry,
  rankModelsByUsage,
  selectMetricsCandidates,
} from '../anyrouter-dynamic-models'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function model(
  partial: Partial<AnyRouterModelListItem> & { id: string }
): AnyRouterModelListItem {
  return {
    name: partial.id,
    context_length: 128_000,
    capabilities: ['chat', 'streaming', 'function-calling'],
    supported_parameters: ['max_tokens', 'temperature'],
    ...partial,
  }
}

const FIXTURE_CATALOG: AnyRouterModelListItem[] = [
  model({
    id: 'anyrouter/agent',
    description: 'Agent router',
    capabilities: ['chat', 'streaming', 'function-calling'],
  }),
  model({
    id: 'anyrouter/free',
    description: 'Free router',
    capabilities: ['chat', 'streaming', 'function-calling'],
  }),
  model({
    id: 'anyrouter/coding',
    description: 'Coding router',
    capabilities: ['chat', 'streaming', 'coding', 'function-calling'],
  }),
  model({
    id: 'popular/tool-model',
    description: 'Popular tool model',
    capabilities: ['chat', 'function-calling', 'coding'],
    pricing: { input_per_1m: 0.1, output_per_1m: 0.3 },
  }),
  model({
    id: 'mid/tool-model',
    description: 'Mid usage tool model',
    capabilities: ['chat', 'function-calling'],
    pricing: { input_per_1m: 1, output_per_1m: 2 },
  }),
  model({
    id: 'rare/tool-model',
    description: 'Rare tool model',
    capabilities: ['chat', 'function-calling', 'coding'],
  }),
  model({
    id: 'chat-only/no-tools',
    description: 'Chat only — not agent-usable',
    capabilities: ['chat', 'streaming'],
    supported_parameters: ['max_tokens'],
  }),
  model({
    id: 'param-tools/legacy',
    description: 'Tools via supported_parameters only',
    capabilities: ['chat'],
    supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
  }),
]

const FIXTURE_METRICS: Record<string, number> = {
  'popular/tool-model': 5000,
  'mid/tool-model': 200,
  'rare/tool-model': 3,
  'param-tools/legacy': 900,
  // chat-only intentionally omitted
}

function createMockFetch(opts?: {
  listStatus?: number
  metricsFailIds?: Set<string>
  throwList?: boolean
}): typeof fetch {
  const listStatus = opts?.listStatus ?? 200
  const metricsFail = opts?.metricsFailIds ?? new Set<string>()
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/models') || url.includes('/models?')) {
      if (opts?.throwList) throw new Error('network down')
      return new Response(JSON.stringify({ data: FIXTURE_CATALOG }), {
        status: listStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    const metricsMatch = url.match(/\/models\/([^/]+)\/metrics$/)
    if (metricsMatch) {
      const id = decodeURIComponent(metricsMatch[1]!)
      if (metricsFail.has(id) || !(id in FIXTURE_METRICS)) {
        return new Response(
          JSON.stringify({ error: { code: 'model_not_found' } }),
          { status: 404 }
        )
      }
      return new Response(
        JSON.stringify({
          model_id: id,
          request_count: FIXTURE_METRICS[id],
          success_count: FIXTURE_METRICS[id],
          error_count: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

beforeEach(() => {
  __resetAnyRouterDynamicCachesForTests()
})

afterEach(() => {
  __resetAnyRouterDynamicCachesForTests()
  delete process.env.ANYROUTER_API_KEY
  delete process.env.ANYROUTER_DYNAMIC_MODELS
  delete process.env.ANYROUTER_TOP_MODELS_N
  delete process.env.ANYROUTER_METRICS_CANDIDATE_CAP
})

// ── pure capability / filter ─────────────────────────────────────────────────

describe('isAgentToolCapable / router helpers', () => {
  test('detects function-calling capability', () => {
    expect(
      isAgentToolCapable(model({ id: 'x', capabilities: ['function-calling'] }))
    ).toBe(true)
  })

  test('detects tools via supported_parameters', () => {
    expect(
      isAgentToolCapable(
        model({
          id: 'x',
          capabilities: ['chat'],
          supported_parameters: ['tools'],
        })
      )
    ).toBe(true)
  })

  test('rejects chat-only models', () => {
    expect(
      isAgentToolCapable(
        model({
          id: 'x',
          capabilities: ['chat'],
          supported_parameters: ['max_tokens'],
        })
      )
    ).toBe(false)
  })

  test('identifies router aliases and auto ids', () => {
    expect(isAnyRouterRouterAlias('anyrouter/agent')).toBe(true)
    expect(isAnyRouterRouterAlias('google/gemma')).toBe(false)
    expect(isAnyRouterAutoModelId(ANYROUTER_AUTO_MODEL_ID)).toBe(true)
    expect(isAnyRouterAutoModelId('anyrouter:google/gemma')).toBe(false)
  })
})

// ── candidate selection ──────────────────────────────────────────────────────

describe('selectMetricsCandidates', () => {
  test('excludes router aliases and non-tool models, prefers coding', () => {
    const selected = selectMetricsCandidates(FIXTURE_CATALOG, 10)
    const ids = selected.map((m) => m.id)
    expect(ids).not.toContain('anyrouter/agent')
    expect(ids).not.toContain('chat-only/no-tools')
    // coding-capable tool models come first
    expect(ids[0]).toBe('popular/tool-model')
    expect(ids).toContain('param-tools/legacy')
  })

  test('respects maxCandidates cap', () => {
    expect(selectMetricsCandidates(FIXTURE_CATALOG, 2)).toHaveLength(2)
    expect(selectMetricsCandidates(FIXTURE_CATALOG, 0)).toHaveLength(0)
  })
})

// ── rank by usage ────────────────────────────────────────────────────────────

describe('rankModelsByUsage', () => {
  const rows: RankInput[] = FIXTURE_CATALOG.filter(
    (m) => !isAnyRouterRouterAlias(m.id)
  ).map((m) => ({
    model: m,
    requestCount: FIXTURE_METRICS[m.id] ?? null,
  }))

  test('sorts higher request_count first', () => {
    const ranked = rankModelsByUsage(rows, 10)
    expect(ranked.map((r) => r.modelId)).toEqual([
      'popular/tool-model',
      'param-tools/legacy',
      'mid/tool-model',
      'rare/tool-model',
    ])
    expect(ranked[0]!.requestCount).toBe(5000)
  })

  test('excludes non-tool models even if they had metrics', () => {
    const withChatOnly: RankInput[] = [
      ...rows,
      {
        model: model({
          id: 'chat-only/no-tools',
          capabilities: ['chat'],
          supported_parameters: ['max_tokens'],
        }),
        requestCount: 999_999,
      },
    ]
    const ranked = rankModelsByUsage(withChatOnly, 10)
    expect(ranked.map((r) => r.modelId)).not.toContain('chat-only/no-tools')
  })

  test('models without metrics rank last', () => {
    const mixed: RankInput[] = [
      {
        model: model({
          id: 'no-metrics/a',
          capabilities: ['function-calling'],
        }),
        requestCount: null,
      },
      {
        model: model({
          id: 'has-metrics/b',
          capabilities: ['function-calling'],
        }),
        requestCount: 10,
      },
      {
        model: model({
          id: 'no-metrics/c',
          capabilities: ['function-calling'],
        }),
        requestCount: undefined,
      },
    ]
    const ranked = rankModelsByUsage(mixed, 10)
    expect(ranked.map((r) => r.modelId)).toEqual([
      'has-metrics/b',
      'no-metrics/a',
      'no-metrics/c',
    ])
  })

  test('limit N caps the dynamic top list', () => {
    expect(rankModelsByUsage(rows, 2)).toHaveLength(2)
    expect(rankModelsByUsage(rows, 2)[0]!.modelId).toBe('popular/tool-model')
    expect(rankModelsByUsage(rows, 0)).toHaveLength(0)
  })
})

// ── routers + auto + merge ───────────────────────────────────────────────────

describe('routers, auto, merge', () => {
  test('extractPreferredRouters keeps preferred order when present', () => {
    const routers = extractPreferredRouters(FIXTURE_CATALOG)
    expect(routers.map((r) => r.modelId)).toEqual([
      'anyrouter/agent',
      'anyrouter/free',
      'anyrouter/coding',
    ])
    expect(routers.every((r) => r.isRouterAlias)).toBe(true)
  })

  test('pickTopUsageModelId prefers positive usage tool models', () => {
    const ranked = rankModelsByUsage(
      FIXTURE_CATALOG.filter((m) => !isAnyRouterRouterAlias(m.id)).map((m) => ({
        model: m,
        requestCount: FIXTURE_METRICS[m.id] ?? null,
      })),
      5
    )
    expect(pickTopUsageModelId(ranked)).toBe('anyrouter:popular/tool-model')
  })

  test('buildAnyRouterAutoEntry documents current top model', () => {
    const auto = buildAnyRouterAutoEntry('popular/tool-model')
    expect(auto.id).toBe(ANYROUTER_AUTO_MODEL_ID)
    expect(auto.description).toContain('popular/tool-model')
  })

  test('merge keeps static on id collision and prepends dynamic-only', () => {
    const staticModels = [
      {
        id: 'anyrouter:mid/tool-model',
        label: 'static-mid',
      },
      { id: 'openrouter:openrouter/free', label: 'or-free' },
    ]
    const dynamic = [
      { id: ANYROUTER_AUTO_MODEL_ID, label: 'auto' },
      { id: 'anyrouter:popular/tool-model', label: 'dyn-popular' },
      { id: 'anyrouter:mid/tool-model', label: 'dyn-mid-should-lose' },
    ]
    const merged = mergeAnyRouterDynamicModels(staticModels, dynamic)
    expect(merged.map((m) => m.id)).toEqual([
      ANYROUTER_AUTO_MODEL_ID,
      'anyrouter:popular/tool-model',
      'anyrouter:mid/tool-model',
      'openrouter:openrouter/free',
    ])
    expect(merged.find((m) => m.id === 'anyrouter:mid/tool-model')?.label).toBe(
      'static-mid'
    )
  })

  test('rankedToAgentModelEntry sets provider anyrouter + usage metadata', () => {
    const ranked = rankModelsByUsage(
      [
        {
          model: model({
            id: 'popular/tool-model',
            capabilities: ['function-calling'],
          }),
          requestCount: 42,
        },
      ],
      1
    )[0]!
    const entry = rankedToAgentModelEntry(ranked, 0)
    expect(entry.provider).toBe('anyrouter')
    expect(entry.id).toBe('anyrouter:popular/tool-model')
    expect(entry.dynamic).toBe(true)
    expect(entry.usageRank).toBe(1)
    expect(entry.requestCount).toBe(42)
    expect(entry.supportsTools).toBe(true)
  })
})

// ── I/O with mock fetch ──────────────────────────────────────────────────────

describe('buildAnyRouterDynamicModels (mocked fetch)', () => {
  test('produces auto + routers + usage-ordered anyrouter entries', async () => {
    process.env.ANYROUTER_API_KEY = 'test-key'
    const { entries, topUsageId } = await buildAnyRouterDynamicModels({
      fetchImpl: createMockFetch(),
      forceRefresh: true,
      topN: 3,
      candidateCap: 10,
    })

    expect(entries[0]!.id).toBe(ANYROUTER_AUTO_MODEL_ID)
    expect(entries.some((e) => e.modelId === 'anyrouter/agent')).toBe(true)
    const usage = entries.filter((e) => e.source === 'usage-ranked')
    expect(usage.map((u) => u.modelId)).toEqual([
      'popular/tool-model',
      'param-tools/legacy',
      'mid/tool-model',
    ])
    expect(topUsageId).toBe('anyrouter:popular/tool-model')
    // auto description mentions the live top model
    expect(entries[0]!.description).toContain('popular/tool-model')
  })

  test('auto pick resolves to top-ranked dynamic model from fixtures', async () => {
    const { topUsageId } = await buildAnyRouterDynamicModels({
      fetchImpl: createMockFetch(),
      forceRefresh: true,
    })
    expect(topUsageId).toBe('anyrouter:popular/tool-model')
    expect(topUsageId).not.toBe('anyrouter:rare/tool-model')
  })

  test('list failure throws from build (caller fail-softs)', async () => {
    await expect(
      buildAnyRouterDynamicModels({
        fetchImpl: createMockFetch({ listStatus: 503 }),
        forceRefresh: true,
      })
    ).rejects.toThrow(/AnyRouter models list error: 503/)
  })

  test('loadAnyRouterDynamicModelEntries returns [] on fetch throw (fail-soft)', async () => {
    process.env.ANYROUTER_API_KEY = 'test-key'
    const entries = await loadAnyRouterDynamicModelEntries({
      fetchImpl: createMockFetch({ throwList: true }),
      forceRefresh: true,
    })
    expect(entries).toEqual([])
  })

  test('loadAnyRouterDynamicModelEntries returns [] when AnyRouter unconfigured', async () => {
    delete process.env.ANYROUTER_API_KEY
    const entries = await loadAnyRouterDynamicModelEntries({
      forceRefresh: true,
    })
    expect(entries).toEqual([])
  })

  test('missing metrics for some candidates still ranks the rest', async () => {
    const { entries } = await buildAnyRouterDynamicModels({
      fetchImpl: createMockFetch({
        metricsFailIds: new Set(['mid/tool-model']),
      }),
      forceRefresh: true,
      topN: 5,
    })
    const usage = entries.filter((e) => e.source === 'usage-ranked')
    expect(usage[0]!.modelId).toBe('popular/tool-model')
    // mid still present (candidate) but with requestCount 0 → after scored ones
    const mid = usage.find((u) => u.modelId === 'mid/tool-model')
    expect(mid?.requestCount).toBe(0)
  })
})

// ── endpoint-style merge simulation ──────────────────────────────────────────

describe('models endpoint merge simulation', () => {
  test('with AnyRouter configured, dynamic entries prepend and order by usage', async () => {
    process.env.ANYROUTER_API_KEY = 'ar-key'
    const dynamic = await loadAnyRouterDynamicModelEntries({
      fetchImpl: createMockFetch(),
      forceRefresh: true,
      topN: 2,
    })
    const staticModels = [
      {
        id: 'anyrouter:google/gemma-4-26b-a4b-it',
        modelId: 'google/gemma-4-26b-a4b-it',
        provider: 'anyrouter',
        name: 'google/gemma-4-26b-a4b-it',
        description: 'static',
        contextLength: 262_144,
        formattedContextLength: '262K',
        isFree: false,
        available: true,
      },
      {
        id: 'openrouter:openrouter/free',
        modelId: 'openrouter/free',
        provider: 'openrouter',
        name: 'openrouter/free',
        description: 'static or',
        contextLength: 200_000,
        formattedContextLength: '200K',
        isFree: true,
        available: true,
      },
    ]
    const merged = mergeAnyRouterDynamicModels(staticModels, dynamic)
    expect(merged[0]!.id).toBe(ANYROUTER_AUTO_MODEL_ID)
    expect(merged.some((m) => m.id === 'anyrouter:popular/tool-model')).toBe(
      true
    )
    // usage order among dynamic concrete models
    const dynConcrete = merged.filter(
      (m) =>
        m.id.startsWith('anyrouter:') &&
        m.id !== ANYROUTER_AUTO_MODEL_ID &&
        !m.id.startsWith('anyrouter:anyrouter/')
    )
    const popularIdx = dynConcrete.findIndex(
      (m) => m.id === 'anyrouter:popular/tool-model'
    )
    const legacyIdx = dynConcrete.findIndex(
      (m) => m.id === 'anyrouter:param-tools/legacy'
    )
    expect(popularIdx).toBeGreaterThanOrEqual(0)
    expect(legacyIdx).toBeGreaterThan(popularIdx)
    // static still present
    expect(
      merged.some((m) => m.id === 'anyrouter:google/gemma-4-26b-a4b-it')
    ).toBe(true)
    expect(merged.some((m) => m.id === 'openrouter:openrouter/free')).toBe(true)
  })

  test('unconfigured / throw keeps static registry path working', async () => {
    delete process.env.ANYROUTER_API_KEY
    const dynamic = await loadAnyRouterDynamicModelEntries({
      forceRefresh: true,
    })
    expect(dynamic).toEqual([])
    const staticModels = [
      { id: 'openrouter:openrouter/free', provider: 'openrouter' },
    ]
    const merged = mergeAnyRouterDynamicModels(staticModels, dynamic)
    expect(merged).toEqual(staticModels)
  })
})
