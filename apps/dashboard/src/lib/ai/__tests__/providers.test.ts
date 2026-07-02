import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))

const { isProviderConfigured, parseModelId, resolveProvider } = await import(
  '../providers'
)

describe('parseModelId', () => {
  test('parses provider:model format', () => {
    expect(parseModelId('openrouter:qwen/qwen3.5-397b-a17b')).toEqual({
      provider: 'openrouter',
      model: 'qwen/qwen3.5-397b-a17b',
    })
  })

  test('parses nvidia provider', () => {
    expect(
      parseModelId('nvidia:nvidia/llama-3.1-nemotron-70b-instruct')
    ).toEqual({
      provider: 'nvidia',
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    })
  })

  test('parses openrouter:openrouter/free', () => {
    expect(parseModelId('openrouter:openrouter/free')).toEqual({
      provider: 'openrouter',
      model: 'openrouter/free',
    })
  })

  test('unprefixed free model uses OpenRouter provider', () => {
    expect(parseModelId('qwen/qwen3-coder:free')).toEqual({
      provider: 'openrouter',
      model: 'qwen/qwen3-coder:free',
    })
  })

  test('unknown non-free model defaults to legacy provider marker', () => {
    expect(parseModelId('custom/model:v1')).toEqual({
      provider: 'legacy',
      model: 'custom/model:v1',
    })
  })

  test('unprefixed openrouter/free uses OpenRouter provider', () => {
    expect(parseModelId('openrouter/free')).toEqual({
      provider: 'openrouter',
      model: 'openrouter/free',
    })
  })

  // Regression: the reported 500 came from `anyrouter:google/gemma-4-26b`.
  // The model id itself contains a slash, so only the FIRST ':' may be treated
  // as the provider separator — the slash must stay part of the model name.
  test('parses anyrouter provider with a slash in the model id', () => {
    expect(parseModelId('anyrouter:google/gemma-4-26b')).toEqual({
      provider: 'anyrouter',
      model: 'google/gemma-4-26b',
    })
  })

  test('keeps a trailing :free tag on a prefixed slash model', () => {
    expect(parseModelId('anyrouter:qwen/qwen3-coder:free')).toEqual({
      provider: 'anyrouter',
      model: 'qwen/qwen3-coder:free',
    })
  })
})

describe('resolveProvider', () => {
  const originalEnv = process.env

  function setEnv(vars: Record<string, string | undefined>) {
    process.env = { ...originalEnv, ...vars }
  }

  afterEach(() => {
    process.env = originalEnv
  })

  test('resolves nvidia provider with NVIDIA_API_KEY', () => {
    setEnv({ NVIDIA_API_KEY: 'nvapi-test-key' })
    const resolved = resolveProvider(
      'nvidia:nvidia/llama-3.1-nemotron-70b-instruct'
    )
    expect(resolved.providerId).toBe('nvidia')
    expect(resolved.apiKey).toBe('nvapi-test-key')
    expect(resolved.baseURL).toBe('https://integrate.api.nvidia.com/v1')
    expect(resolved.sdk).toBe('openai')
    expect(resolved.isOpenRouter).toBe(false)
  })

  test('nvidia does not fall back to LLM_API_KEY', () => {
    setEnv({ LLM_API_KEY: 'fallback-key', NVIDIA_API_KEY: undefined })
    const resolved = resolveProvider(
      'nvidia:nvidia/llama-3.1-nemotron-70b-instruct'
    )
    expect(resolved.apiKey).toBe('')
  })

  test('resolves openrouter provider', () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test-key' })
    const resolved = resolveProvider('openrouter:qwen/qwen3.5-397b-a17b')
    expect(resolved.providerId).toBe('openrouter')
    expect(resolved.apiKey).toBe('or-test-key')
    expect(resolved.sdk).toBe('openrouter')
    expect(resolved.isOpenRouter).toBe(true)
  })

  test('resolves anyrouter provider', () => {
    setEnv({ ANYROUTER_API_KEY: 'ar-test-key' })
    const resolved = resolveProvider('anyrouter:z-ai/glm-4.7-flash')
    expect(resolved.providerId).toBe('anyrouter')
    expect(resolved.apiKey).toBe('ar-test-key')
    expect(resolved.baseURL).toBe('https://anyrouter.dev/api/v1')
    expect(resolved.sdk).toBe('openai')
  })

  // Regression for the reported 500 model id (slash inside the model name).
  test('resolves anyrouter provider for a slash-containing model id', () => {
    setEnv({ ANYROUTER_API_KEY: 'ar-test-key' })
    const resolved = resolveProvider('anyrouter:google/gemma-4-26b')
    expect(resolved.providerId).toBe('anyrouter')
    expect(resolved.apiKey).toBe('ar-test-key')
    expect(resolved.baseURL).toBe('https://anyrouter.dev/api/v1')
    expect(resolved.sdk).toBe('openai')
    expect(resolved.isOpenRouter).toBe(false)
  })

  test('unprefixed free model uses OpenRouter key cascade', () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test-key', LLM_API_KEY: undefined })
    const resolved = resolveProvider('qwen/qwen3-coder:free')
    expect(resolved.providerId).toBe('openrouter')
    expect(resolved.apiKey).toBe('or-test-key')
    expect(resolved.isOpenRouter).toBe(true)
  })

  test('unprefixed openrouter/free uses OpenRouter key cascade', () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test-key', LLM_API_KEY: undefined })
    const resolved = resolveProvider('openrouter/free')
    expect(resolved.providerId).toBe('openrouter')
    expect(resolved.apiKey).toBe('or-test-key')
    expect(resolved.isOpenRouter).toBe(true)
  })

  test('nvidia uses NVIDIA_API_BASE env var override', () => {
    setEnv({
      NVIDIA_API_KEY: 'nvapi-test',
      NVIDIA_API_BASE: 'http://custom-nvidia.local/v1',
    })
    const resolved = resolveProvider('nvidia:nvidia/test-model')
    expect(resolved.baseURL).toBe('http://custom-nvidia.local/v1')
  })
})

describe('isProviderConfigured', () => {
  const originalEnv = process.env

  function setEnv(vars: Record<string, string | undefined>) {
    process.env = { ...originalEnv, ...vars }
  }

  afterEach(() => {
    process.env = originalEnv
  })

  test('recognizes provider-specific AnyRouter key without LLM_API_KEY', () => {
    setEnv({
      ANYROUTER_API_KEY: 'sk-ar-test',
      LLM_API_KEY: undefined,
    })

    expect(isProviderConfigured('anyrouter')).toBe(true)
  })

  test('does not mark AnyRouter configured from generic LLM_API_KEY', () => {
    setEnv({
      ANYROUTER_API_KEY: undefined,
      LLM_API_KEY: 'fallback-key',
    })

    expect(isProviderConfigured('anyrouter')).toBe(false)
  })

  test('recognizes OpenRouter from provider key or generic LLM_API_KEY', () => {
    setEnv({
      OPENROUTER_API_KEY: undefined,
      LLM_API_KEY: 'fallback-key',
    })

    expect(isProviderConfigured('openrouter')).toBe(true)

    setEnv({
      OPENROUTER_API_KEY: 'or-test-key',
      LLM_API_KEY: undefined,
    })

    expect(isProviderConfigured('openrouter')).toBe(true)
  })

  test('does not mark NVIDIA configured from generic LLM_API_KEY', () => {
    setEnv({
      NVIDIA_API_KEY: undefined,
      LLM_API_KEY: 'fallback-key',
    })

    expect(isProviderConfigured('nvidia')).toBe(false)
  })
})
