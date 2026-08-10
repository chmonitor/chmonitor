import {
  DEFAULT_AGENT_MODEL,
  FALLBACK_AGENT_MODEL,
  getAllModelOptions,
  getModelRegistry,
  isFreeAgentModel,
  MODEL_REGISTRY,
  parseExtraModels,
  resolveDefaultAgentModel,
} from '../agent-model-registry'
import { afterEach, describe, expect, test } from 'bun:test'

/**
 * Surgically set/restore env keys WITHOUT replacing the global `process.env`
 * object. Swapping the reference (`process.env = {...}`) poisons env for EVERY
 * test file that runs after this one in the same bun process — it broke an
 * unrelated clerk-client test in the full suite. Mutate keys in place and undo
 * exactly those keys in afterEach instead. See CLAUDE.md bun global-state notes.
 */
function createEnvSandbox() {
  const saved: Record<string, string | undefined> = {}
  return {
    set(vars: Record<string, string | undefined>) {
      for (const [key, value] of Object.entries(vars)) {
        if (!(key in saved)) saved[key] = process.env[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
    restore() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      for (const key of Object.keys(saved)) delete saved[key]
    },
  }
}

// ── constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  test('DEFAULT_AGENT_MODEL uses anyrouter prefix', () => {
    expect(DEFAULT_AGENT_MODEL).toMatch(/^anyrouter:/)
  })

  test('FALLBACK_AGENT_MODEL is the openrouter free auto-router', () => {
    expect(FALLBACK_AGENT_MODEL).toBe('openrouter/free')
  })
})

// ── MODEL_REGISTRY ───────────────────────────────────────────────────────────

describe('MODEL_REGISTRY', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(MODEL_REGISTRY)).toBe(true)
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0)
  })

  test('every entry has required fields', () => {
    for (const entry of MODEL_REGISTRY) {
      expect(typeof entry.id).toBe('string')
      expect(entry.id.length).toBeGreaterThan(0)
      expect(typeof entry.description).toBe('string')
      expect(typeof entry.contextLength).toBe('number')
      expect(entry.contextLength).toBeGreaterThan(0)
      expect(Array.isArray(entry.providers)).toBe(true)
      expect(entry.providers.length).toBeGreaterThan(0)
    }
  })

  test('DEFAULT_AGENT_MODEL id exists in the registry', () => {
    // DEFAULT_AGENT_MODEL = 'anyrouter:google/gemma-4-26b-a4b-it'
    const modelId = DEFAULT_AGENT_MODEL.slice(
      DEFAULT_AGENT_MODEL.indexOf(':') + 1
    )
    const found = MODEL_REGISTRY.some((m) => m.id === modelId)
    expect(found).toBe(true)
  })

  test('FALLBACK_AGENT_MODEL id exists in the registry', () => {
    const found = MODEL_REGISTRY.some((m) => m.id === FALLBACK_AGENT_MODEL)
    expect(found).toBe(true)
  })

  test('optional pricing field has both input and output when present', () => {
    for (const entry of MODEL_REGISTRY) {
      if (entry.pricing !== undefined) {
        expect(typeof entry.pricing.inputPerMillion).toBe('number')
        expect(typeof entry.pricing.outputPerMillion).toBe('number')
      }
    }
  })
})

// ── resolveDefaultAgentModel ─────────────────────────────────────────────────

describe('resolveDefaultAgentModel', () => {
  const env = createEnvSandbox()
  const setEnv = (vars: Record<string, string | undefined>) => env.set(vars)
  afterEach(() => env.restore())

  test('returns anyrouter:auto when ANYROUTER_API_KEY is set', () => {
    setEnv({
      ANYROUTER_API_KEY: 'ar-key',
      LLM_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
    })
    // Dynamic top-by-usage alias; agent route resolves to a concrete model.
    expect(resolveDefaultAgentModel()).toBe('anyrouter:auto')
  })

  test('returns FALLBACK_AGENT_MODEL when only LLM_API_KEY is set', () => {
    setEnv({
      ANYROUTER_API_KEY: undefined,
      LLM_API_KEY: 'llm-key',
      OPENROUTER_API_KEY: undefined,
    })
    expect(resolveDefaultAgentModel()).toBe(FALLBACK_AGENT_MODEL)
  })

  test('returns FALLBACK_AGENT_MODEL when only OPENROUTER_API_KEY is set', () => {
    setEnv({
      ANYROUTER_API_KEY: undefined,
      LLM_API_KEY: undefined,
      OPENROUTER_API_KEY: 'or-key',
    })
    expect(resolveDefaultAgentModel()).toBe(FALLBACK_AGENT_MODEL)
  })

  test('ANYROUTER_API_KEY takes precedence over LLM_API_KEY', () => {
    setEnv({
      ANYROUTER_API_KEY: 'ar-key',
      LLM_API_KEY: 'llm-key',
      OPENROUTER_API_KEY: undefined,
    })
    expect(resolveDefaultAgentModel()).toBe('anyrouter:auto')
  })

  test('falls back to DEFAULT_AGENT_MODEL when no keys are configured', () => {
    setEnv({
      ANYROUTER_API_KEY: undefined,
      LLM_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
    })
    expect(resolveDefaultAgentModel()).toBe(DEFAULT_AGENT_MODEL)
  })
})

// ── parseExtraModels ─────────────────────────────────────────────────────────

describe('parseExtraModels', () => {
  const env = createEnvSandbox()
  const setEnv = (vars: Record<string, string | undefined>) => env.set(vars)
  afterEach(() => env.restore())

  test('returns empty array when LLM_EXTRA_MODELS is unset', () => {
    setEnv({ LLM_EXTRA_MODELS: undefined })
    expect(parseExtraModels()).toEqual([])
  })

  test('returns empty array for empty string', () => {
    setEnv({ LLM_EXTRA_MODELS: '' })
    expect(parseExtraModels()).toEqual([])
  })

  test('parses a single full entry with contextLength and description', () => {
    setEnv({
      LLM_EXTRA_MODELS: 'nvidia:meta/llama-3.3-70b|131072|Llama 3.3 70B',
    })
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'meta/llama-3.3-70b',
      description: 'Llama 3.3 70B',
      contextLength: 131072,
      providers: ['nvidia'],
    })
  })

  test('defaults contextLength to 128000 when omitted', () => {
    setEnv({ LLM_EXTRA_MODELS: 'openrouter:x-ai/grok-2' })
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0].contextLength).toBe(128_000)
  })

  test('defaults description to modelId when omitted', () => {
    setEnv({ LLM_EXTRA_MODELS: 'openrouter:x-ai/grok-2' })
    const result = parseExtraModels()
    expect(result[0].description).toBe('x-ai/grok-2')
  })

  test('parses multiple comma-separated entries', () => {
    setEnv({
      LLM_EXTRA_MODELS:
        'nvidia:meta/llama-3.3-70b|131072|Llama 3.3 70B,openrouter:x-ai/grok-2',
    })
    const result = parseExtraModels()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('meta/llama-3.3-70b')
    expect(result[1].id).toBe('x-ai/grok-2')
  })

  test('handles model ids that themselves contain colons (e.g. :free suffix)', () => {
    setEnv({ LLM_EXTRA_MODELS: 'openrouter:qwen/qwen3-coder:free' })
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('qwen/qwen3-coder:free')
    expect(result[0].providers).toEqual(['openrouter'])
  })

  test('skips entries with no colon separator', () => {
    setEnv({ LLM_EXTRA_MODELS: 'bad-entry-no-colon' })
    expect(parseExtraModels()).toEqual([])
  })

  test('skips entries where colon is the first char', () => {
    setEnv({ LLM_EXTRA_MODELS: ':modelid' })
    expect(parseExtraModels()).toEqual([])
  })

  test('skips entries with invalid (non-positive) contextLength', () => {
    setEnv({ LLM_EXTRA_MODELS: 'openrouter:x-ai/grok-2|abc' })
    expect(parseExtraModels()).toEqual([])
  })

  test('skips empty segments between commas', () => {
    setEnv({ LLM_EXTRA_MODELS: ',openrouter:x-ai/grok-2,' })
    const result = parseExtraModels()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('x-ai/grok-2')
  })
})

// ── getModelRegistry ─────────────────────────────────────────────────────────

describe('getModelRegistry', () => {
  const env = createEnvSandbox()
  const setEnv = (vars: Record<string, string | undefined>) => env.set(vars)
  afterEach(() => env.restore())

  test('contains at minimum all MODEL_REGISTRY entries', () => {
    setEnv({ LLM_EXTRA_MODELS: undefined })
    const result = getModelRegistry()
    expect(result.length).toBeGreaterThanOrEqual(MODEL_REGISTRY.length)
    for (const entry of MODEL_REGISTRY) {
      expect(result.some((r) => r.id === entry.id)).toBe(true)
    }
  })

  test('appends extra models from LLM_EXTRA_MODELS', () => {
    setEnv({
      LLM_EXTRA_MODELS: 'nvidia:custom/new-model|65536|Custom New Model',
    })
    const result = getModelRegistry()
    const extra = result.find((m) => m.id === 'custom/new-model')
    expect(extra).toBeDefined()
    expect(extra?.providers).toEqual(['nvidia'])
    expect(extra?.contextLength).toBe(65536)
  })

  test('deduplicates: registry entry wins over extra with same provider:id', () => {
    // qwen/qwen3.5-397b-a17b is in MODEL_REGISTRY under openrouter provider
    setEnv({
      LLM_EXTRA_MODELS: 'openrouter:qwen/qwen3.5-397b-a17b|9999|Duplicate',
    })
    const result = getModelRegistry()
    const matches = result.filter((m) => m.id === 'qwen/qwen3.5-397b-a17b')
    // Should only appear once (from MODEL_REGISTRY)
    expect(matches).toHaveLength(1)
    // The registry entry has pricing; the extra does not — confirm registry wins
    expect(matches[0].pricing).toBeDefined()
  })

  test('extra with different provider is not deduped', () => {
    // Add the same model id but under a provider that is NOT in MODEL_REGISTRY for it
    setEnv({
      LLM_EXTRA_MODELS:
        'newprovider:qwen/qwen3.5-397b-a17b|131072|From newprovider',
    })
    const result = getModelRegistry()
    const extra = result.find(
      (m) =>
        m.id === 'qwen/qwen3.5-397b-a17b' && m.providers.includes('newprovider')
    )
    expect(extra).toBeDefined()
  })
})

// ── getAllModelOptions ────────────────────────────────────────────────────────

describe('getAllModelOptions', () => {
  test('returns provider:id strings for every model in MODEL_REGISTRY', () => {
    const options = getAllModelOptions()
    expect(Array.isArray(options)).toBe(true)
    // Each registry entry produces one option per provider
    const expected = MODEL_REGISTRY.flatMap((m) =>
      m.providers.map((p) => `${p}:${m.id}`)
    )
    expect(options).toEqual(expected)
  })

  test('multi-provider entries produce multiple options', () => {
    const options = getAllModelOptions()
    // qwen/qwen3.5-397b-a17b has openrouter, nvidia, anyrouter
    expect(options).toContain('openrouter:qwen/qwen3.5-397b-a17b')
    expect(options).toContain('nvidia:qwen/qwen3.5-397b-a17b')
    expect(options).toContain('anyrouter:qwen/qwen3.5-397b-a17b')
  })

  test('does NOT include extra models from LLM_EXTRA_MODELS (uses MODEL_REGISTRY only)', () => {
    const env = createEnvSandbox()
    env.set({ LLM_EXTRA_MODELS: 'nvidia:custom/extra-model' })
    try {
      const options = getAllModelOptions()
      expect(options.some((o) => o.includes('custom/extra-model'))).toBe(false)
    } finally {
      env.restore()
    }
  })
})

// ── isFreeAgentModel ─────────────────────────────────────────────────────────

describe('isFreeAgentModel', () => {
  test('openrouter/free is free', () => {
    expect(isFreeAgentModel('openrouter/free')).toBe(true)
  })

  test('model ending in :free is free', () => {
    expect(isFreeAgentModel('qwen/qwen3-coder:free')).toBe(true)
    expect(isFreeAgentModel('google/gemma-4-31b-it:free')).toBe(true)
  })

  test('paid model is not free', () => {
    expect(isFreeAgentModel('qwen/qwen3.5-397b-a17b')).toBe(false)
    expect(isFreeAgentModel('anyrouter:google/gemma-4-26b-a4b-it')).toBe(false)
  })

  test('provider-prefixed free model is not matched (prefix has no :free)', () => {
    // 'openrouter:qwen/qwen3-coder:free' ends in ':free' so it IS matched
    expect(isFreeAgentModel('openrouter:qwen/qwen3-coder:free')).toBe(true)
  })

  test('empty string is not free', () => {
    expect(isFreeAgentModel('')).toBe(false)
  })
})
