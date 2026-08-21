import {
  DEFAULT_AGENT_MODEL,
  FALLBACK_AGENT_MODEL,
  getAllModelOptions,
  getModelRegistry,
  MODEL_REGISTRY,
  parseExtraModels,
  resolveDefaultAgentModel,
} from './agent-model-registry'
import { isFreeAgentModel } from './agent-models'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

describe('isFreeAgentModel', () => {
  test('recognizes OpenRouter free router and explicit free suffixes', () => {
    expect(isFreeAgentModel('openrouter/free')).toBe(true)
    expect(isFreeAgentModel('qwen/qwen3-coder:free')).toBe(true)
  })

  test('does not treat unknown pricing as free', () => {
    expect(isFreeAgentModel('openrouter/auto')).toBe(false)
    expect(isFreeAgentModel('minimax/minimax-m2.7')).toBe(false)
  })
})

describe('AnyRouter model registry', () => {
  test('defaults to AnyRouter Gemma 4 26B and includes curated free models', () => {
    const options = getAllModelOptions()

    expect(DEFAULT_AGENT_MODEL).toBe('anyrouter:google/gemma-4-26b-a4b-it')
    expect(options).toContain('openrouter:openrouter/free')
    expect(options).toContain('anyrouter:z-ai/glm-4.7-flash')
    expect(options).toContain('anyrouter:google/gemini-3.1-flash-lite')
    expect(options).toContain('anyrouter:google/gemma-4-26b-a4b-it')
  })
})

describe('resolveDefaultAgentModel', () => {
  const originalAnyRouter = process.env.ANYROUTER_API_KEY
  const originalLLM = process.env.LLM_API_KEY
  const originalOpenRouter = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    delete process.env.ANYROUTER_API_KEY
    delete process.env.LLM_API_KEY
    delete process.env.OPENROUTER_API_KEY
  })

  afterEach(() => {
    if (originalAnyRouter) process.env.ANYROUTER_API_KEY = originalAnyRouter
    if (originalLLM) process.env.LLM_API_KEY = originalLLM
    if (originalOpenRouter) process.env.OPENROUTER_API_KEY = originalOpenRouter
  })

  test('prefers anyrouter:auto when ANYROUTER_API_KEY is set', () => {
    process.env.ANYROUTER_API_KEY = 'ar-test'
    // Auto resolves at request time to top-by-usage; static Gemma is the
    // fail-soft concrete fallback (DEFAULT_AGENT_MODEL).
    expect(resolveDefaultAgentModel()).toBe('anyrouter:auto')
    expect(DEFAULT_AGENT_MODEL).toBe('anyrouter:google/gemma-4-26b-a4b-it')
  })

  test('falls back to openrouter/free when only LLM_API_KEY is set', () => {
    process.env.LLM_API_KEY = 'or-test'
    expect(resolveDefaultAgentModel()).toBe(FALLBACK_AGENT_MODEL)
  })

  test('falls back to openrouter/free when only OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'or-test'
    expect(resolveDefaultAgentModel()).toBe(FALLBACK_AGENT_MODEL)
  })
})

describe('parseExtraModels', () => {
  const originalExtra = process.env.LLM_EXTRA_MODELS

  afterEach(() => {
    if (originalExtra !== undefined) {
      process.env.LLM_EXTRA_MODELS = originalExtra
    } else {
      delete process.env.LLM_EXTRA_MODELS
    }
  })

  test('returns empty array when LLM_EXTRA_MODELS is not set', () => {
    delete process.env.LLM_EXTRA_MODELS
    expect(parseExtraModels()).toEqual([])
  })

  test('returns empty array when LLM_EXTRA_MODELS is empty string', () => {
    process.env.LLM_EXTRA_MODELS = '   '
    expect(parseExtraModels()).toEqual([])
  })

  test('parses a single entry with all fields', () => {
    process.env.LLM_EXTRA_MODELS =
      'nvidia:meta/llama-3.3-70b|131072|Llama 3.3 70B'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'meta/llama-3.3-70b',
      description: 'Llama 3.3 70B',
      contextLength: 131072,
      providers: ['nvidia'],
    })
  })

  test('parses model ID that itself contains a colon (e.g. :free suffix)', () => {
    process.env.LLM_EXTRA_MODELS = 'openrouter:qwen/qwen3-coder:free'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('qwen/qwen3-coder:free')
    expect(result[0]?.providers).toEqual(['openrouter'])
  })

  test('defaults contextLength to 128000 when not provided', () => {
    process.env.LLM_EXTRA_MODELS = 'openrouter:x-ai/grok-2'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.contextLength).toBe(128_000)
  })

  test('defaults description to modelId when not provided', () => {
    process.env.LLM_EXTRA_MODELS = 'openrouter:x-ai/grok-2'
    const result = parseExtraModels()
    expect(result[0]?.description).toBe('x-ai/grok-2')
  })

  test('parses multiple comma-separated entries', () => {
    process.env.LLM_EXTRA_MODELS =
      'nvidia:meta/llama-3.3-70b|131072|Llama 3.3 70B,openrouter:x-ai/grok-2'
    const result = parseExtraModels()
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('meta/llama-3.3-70b')
    expect(result[1]?.id).toBe('x-ai/grok-2')
  })

  test('skips entries without a colon separator', () => {
    process.env.LLM_EXTRA_MODELS = 'nocolonentry,openrouter:valid/model'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('valid/model')
  })

  test('skips entries where colon is the first character', () => {
    process.env.LLM_EXTRA_MODELS = ':modelid,openrouter:valid/model'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('valid/model')
  })

  test('skips entries with non-numeric contextLength', () => {
    process.env.LLM_EXTRA_MODELS =
      'openrouter:some/model|notanumber|Description'
    const result = parseExtraModels()
    expect(result).toHaveLength(0)
  })

  test('skips entries with zero or negative contextLength', () => {
    process.env.LLM_EXTRA_MODELS =
      'openrouter:some/model|0,openrouter:other/model|-1024'
    const result = parseExtraModels()
    expect(result).toHaveLength(0)
  })

  test('skips empty comma segments', () => {
    process.env.LLM_EXTRA_MODELS = 'openrouter:valid/model,,  ,'
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('valid/model')
  })

  test('trims whitespace around entries', () => {
    process.env.LLM_EXTRA_MODELS = '  openrouter:valid/model  '
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('valid/model')
    expect(result[0]?.providers[0]).toBe('openrouter')
  })
})

describe('getModelRegistry', () => {
  const originalExtra = process.env.LLM_EXTRA_MODELS

  afterEach(() => {
    if (originalExtra !== undefined) {
      process.env.LLM_EXTRA_MODELS = originalExtra
    } else {
      delete process.env.LLM_EXTRA_MODELS
    }
  })

  test('includes all built-in MODEL_REGISTRY entries when no extras set', () => {
    delete process.env.LLM_EXTRA_MODELS
    const registry = getModelRegistry()
    for (const entry of MODEL_REGISTRY) {
      expect(registry.some((r) => r.id === entry.id)).toBe(true)
    }
  })

  test('appends extra models from LLM_EXTRA_MODELS', () => {
    process.env.LLM_EXTRA_MODELS = 'openrouter:x-ai/grok-3|131072|Grok 3'
    const registry = getModelRegistry()
    const extra = registry.find((r) => r.id === 'x-ai/grok-3')
    expect(extra).toBeDefined()
    expect(extra?.description).toBe('Grok 3')
    expect(extra?.providers).toEqual(['openrouter'])
  })

  test('built-in entry wins when extra has the same provider:id key', () => {
    // openrouter:openrouter/free already exists in MODEL_REGISTRY
    process.env.LLM_EXTRA_MODELS =
      'openrouter:openrouter/free|999|My Custom Free'
    const registry = getModelRegistry()
    const freeEntries = registry.filter((r) => r.id === 'openrouter/free')
    // Should only have one entry with that id (from registry)
    expect(freeEntries).toHaveLength(1)
    // Description should match original, not the custom one
    expect(freeEntries[0]?.description).not.toBe('My Custom Free')
  })

  test('returns a list at least as long as MODEL_REGISTRY', () => {
    delete process.env.LLM_EXTRA_MODELS
    const registry = getModelRegistry()
    expect(registry.length).toBeGreaterThanOrEqual(MODEL_REGISTRY.length)
  })

  test('extra model with new provider:id pair is not deduplicated', () => {
    process.env.LLM_EXTRA_MODELS = 'nvidia:x-ai/grok-3|131072|Grok 3 on NVIDIA'
    const registry = getModelRegistry()
    const extra = registry.find(
      (r) => r.id === 'x-ai/grok-3' && r.providers.includes('nvidia')
    )
    expect(extra).toBeDefined()
  })
})
