/**
 * Unit tests for AnyRouter preset surfacing in the agent model picker.
 * Fixtures mirror the authenticated `GET {base}/models` response's top-level
 * `presets` array. No live network.
 */

import type { AgentModelListEntry } from '../anyrouter-dynamic-models'

import {
  __resetAnyRouterPresetCachesForTests,
  ANYROUTER_PRESET_MODEL_PREFIX,
  type AnyRouterPreset,
  fetchAnyRouterPresets,
  isAnyRouterPresetModelId,
  loadAnyRouterPresetEntries,
  mergeAnyRouterPresets,
  presetToAgentModelEntry,
} from '../anyrouter-presets'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function entry(
  partial: Partial<AgentModelListEntry> & { id: string }
): AgentModelListEntry {
  return {
    modelId: partial.id,
    provider: 'anyrouter',
    name: partial.id,
    description: '',
    contextLength: 128_000,
    formattedContextLength: '128K',
    isFree: false,
    available: true,
    ...partial,
  }
}

beforeEach(() => {
  __resetAnyRouterPresetCachesForTests()
  delete process.env.ANYROUTER_API_KEY
  delete process.env.ANYROUTER_PRESETS
  delete process.env.ANYROUTER_PRESETS_MAX
})

afterEach(() => {
  __resetAnyRouterPresetCachesForTests()
  delete process.env.ANYROUTER_API_KEY
  delete process.env.ANYROUTER_PRESETS
  delete process.env.ANYROUTER_PRESETS_MAX
})

// ── isAnyRouterPresetModelId ─────────────────────────────────────────────────

describe('isAnyRouterPresetModelId', () => {
  test('true for anyrouter:@preset/<slug>', () => {
    expect(isAnyRouterPresetModelId('anyrouter:@preset/my-preset')).toBe(true)
  })

  test('true for the @presets/ variant', () => {
    expect(isAnyRouterPresetModelId('anyrouter:@presets/my-preset')).toBe(true)
  })

  test('false for a concrete model id', () => {
    expect(isAnyRouterPresetModelId('anyrouter:openai/gpt-5')).toBe(false)
  })

  test('false for a non-anyrouter provider', () => {
    expect(isAnyRouterPresetModelId('openrouter:@preset/x')).toBe(false)
  })

  test('false for malformed ids without a colon', () => {
    expect(isAnyRouterPresetModelId('@preset/x')).toBe(false)
  })
})

// ── presetToAgentModelEntry ──────────────────────────────────────────────────

describe('presetToAgentModelEntry', () => {
  test('builds the anyrouter:@preset/<slug> id and round-trips through isAnyRouterPresetModelId', () => {
    const preset: AnyRouterPreset = { slug: 'my-preset', name: 'My Preset' }
    const result = presetToAgentModelEntry(preset)
    expect(result.id).toBe('anyrouter:@preset/my-preset')
    expect(result.modelId).toBe(`${ANYROUTER_PRESET_MODEL_PREFIX}my-preset`)
    expect(result.provider).toBe('anyrouter')
    expect(isAnyRouterPresetModelId(result.id)).toBe(true)
  })

  test('uses description when present', () => {
    const preset: AnyRouterPreset = {
      slug: 'p1',
      name: 'P1',
      description: 'Custom description',
    }
    expect(presetToAgentModelEntry(preset).description).toBe(
      'Custom description'
    )
  })

  test('synthesizes a description mentioning config.model when description is missing', () => {
    const preset: AnyRouterPreset = {
      slug: 'p2',
      name: 'P2',
      config: { model: 'openai/gpt-5' },
    }
    const result = presetToAgentModelEntry(preset)
    expect(result.description).toContain('openai/gpt-5')
  })

  test('does not fabricate a context length: reports 0 / em-dash', () => {
    const result = presetToAgentModelEntry({ slug: 'p3' })
    expect(result.contextLength).toBe(0)
    expect(result.formattedContextLength).toBe('—')
  })

  test('isFree is false and available is true', () => {
    const result = presetToAgentModelEntry({ slug: 'p4' })
    expect(result.isFree).toBe(false)
    expect(result.available).toBe(true)
  })

  test('falls back to slug when name is missing', () => {
    const result = presetToAgentModelEntry({ slug: 'no-name' })
    expect(result.name).toContain('no-name')
  })
})

// ── fetchAnyRouterPresets ────────────────────────────────────────────────────

describe('fetchAnyRouterPresets', () => {
  test('parses the top-level presets array', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [],
          presets: [
            { slug: 'a', name: 'A' },
            { slug: 'b', name: 'B', description: 'desc' },
          ],
        }),
        { status: 200 }
      )) as unknown as typeof fetch

    const presets = await fetchAnyRouterPresets(fetchImpl)
    expect(presets).toHaveLength(2)
    expect(presets[0]?.slug).toBe('a')
  })

  test('drops malformed/partial preset entries without throwing', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          presets: [
            { slug: 'valid' },
            { name: 'missing slug' },
            null,
            'not-an-object',
            42,
            { slug: '' },
            { slug: '  ' },
          ],
        }),
        { status: 200 }
      )) as unknown as typeof fetch

    const presets = await fetchAnyRouterPresets(fetchImpl)
    expect(presets).toEqual([{ slug: 'valid' }])
  })

  test('returns [] when no API key is configured', async () => {
    const fetchImpl = (async () => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch
    expect(await fetchAnyRouterPresets(fetchImpl)).toEqual([])
  })

  test('returns [] on non-ok response', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const fetchImpl = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    expect(await fetchAnyRouterPresets(fetchImpl)).toEqual([])
  })

  test('returns [] when the response has no presets field', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
      })) as unknown as typeof fetch
    expect(await fetchAnyRouterPresets(fetchImpl)).toEqual([])
  })

  test('returns [] and never leaks the API key on fetch failure', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-super-secret'
    const fetchImpl = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    let caughtMessage = ''
    try {
      const presets = await fetchAnyRouterPresets(fetchImpl)
      expect(presets).toEqual([])
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error)
    }
    expect(caughtMessage).not.toContain('sk-ar-super-secret')
  })
})

// ── loadAnyRouterPresetEntries ───────────────────────────────────────────────

describe('loadAnyRouterPresetEntries', () => {
  function fixtureFetch(presets: AnyRouterPreset[]): typeof fetch {
    return (async () =>
      new Response(JSON.stringify({ presets }), {
        status: 200,
      })) as unknown as typeof fetch
  }

  test('returns [] when the provider is not configured', async () => {
    const result = await loadAnyRouterPresetEntries({
      fetchImpl: fixtureFetch([{ slug: 'a' }]),
    })
    expect(result).toEqual([])
  })

  test('returns [] when disabled via ANYROUTER_PRESETS=false', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    process.env.ANYROUTER_PRESETS = 'false'
    const result = await loadAnyRouterPresetEntries({
      fetchImpl: fixtureFetch([{ slug: 'a' }]),
    })
    expect(result).toEqual([])
  })

  test('returns [] when the fetch fails', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const fetchImpl = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const result = await loadAnyRouterPresetEntries({
      fetchImpl,
      forceRefresh: true,
    })
    expect(result).toEqual([])
  })

  test('caps presets at the default max (8)', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    const many = Array.from({ length: 20 }, (_, i) => ({ slug: `preset-${i}` }))
    const result = await loadAnyRouterPresetEntries({
      fetchImpl: fixtureFetch(many),
      forceRefresh: true,
    })
    expect(result).toHaveLength(8)
  })

  test('clamps ANYROUTER_PRESETS_MAX into [1, 32]', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    process.env.ANYROUTER_PRESETS_MAX = '999'
    const many = Array.from({ length: 40 }, (_, i) => ({ slug: `preset-${i}` }))
    const result = await loadAnyRouterPresetEntries({
      fetchImpl: fixtureFetch(many),
      forceRefresh: true,
    })
    expect(result).toHaveLength(32)
  })

  test('clamps a zero/invalid ANYROUTER_PRESETS_MAX up to the default', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    process.env.ANYROUTER_PRESETS_MAX = '0'
    const many = Array.from({ length: 20 }, (_, i) => ({ slug: `preset-${i}` }))
    const result = await loadAnyRouterPresetEntries({
      fetchImpl: fixtureFetch(many),
      forceRefresh: true,
    })
    expect(result).toHaveLength(8)
  })

  test('reuses the cached result within the TTL (fetch called once)', async () => {
    process.env.ANYROUTER_API_KEY = 'sk-ar-test'
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(JSON.stringify({ presets: [{ slug: 'cached' }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    await loadAnyRouterPresetEntries({ fetchImpl, forceRefresh: true })
    await loadAnyRouterPresetEntries({ fetchImpl })
    expect(calls).toBe(1)
  })
})

// ── mergeAnyRouterPresets ────────────────────────────────────────────────────

describe('mergeAnyRouterPresets', () => {
  test('appends presets after the base list', () => {
    const base = [entry({ id: 'anyrouter:openai/gpt-5' })]
    const presets = [entry({ id: 'anyrouter:@preset/my-preset' })]
    const merged = mergeAnyRouterPresets(base, presets)
    expect(merged).toHaveLength(2)
    expect(merged[0]?.id).toBe('anyrouter:openai/gpt-5')
    expect(merged[1]?.id).toBe('anyrouter:@preset/my-preset')
  })

  test('never drops base entries', () => {
    const base = [
      entry({ id: 'anyrouter:a' }),
      entry({ id: 'anyrouter:b' }),
      entry({ id: 'anyrouter:c' }),
    ]
    const merged = mergeAnyRouterPresets(base, [])
    expect(merged).toEqual(base)
  })

  test('dedupes by id, preferring the base entry', () => {
    const base = [entry({ id: 'anyrouter:@preset/dup', name: 'base-version' })]
    const presets = [
      entry({ id: 'anyrouter:@preset/dup', name: 'preset-version' }),
    ]
    const merged = mergeAnyRouterPresets(base, presets)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.name).toBe('base-version')
  })

  test('dedupes among presets themselves', () => {
    const presets = [
      entry({ id: 'anyrouter:@preset/x' }),
      entry({ id: 'anyrouter:@preset/x' }),
    ]
    const merged = mergeAnyRouterPresets([], presets)
    expect(merged).toHaveLength(1)
  })
})
