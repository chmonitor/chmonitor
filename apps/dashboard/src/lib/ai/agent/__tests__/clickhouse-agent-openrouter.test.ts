// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const openRouterChatMock = mock(() => ({ provider: 'openrouter-chat-model' }))
const openAIChatMock = mock(() => ({ provider: 'openai-chat-model' }))
const createOpenAIOptions: Array<Record<string, unknown>> = []

const anyrouterModelMock = mock(() => ({ provider: 'anyrouter-chat-model' }))
const createAnyRouterOptions: Array<Record<string, unknown>> = []

mock.module('server-only', () => ({}))
mock.module('@/lib/ai/agent/mcp-tool-adapter', () => ({
  createMcpTools: () => ({
    get_running_queries: { description: 'Mock tool' },
  }),
}))
mock.module('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => ({
    chat: openRouterChatMock,
  }),
}))
mock.module('@ai-sdk/openai', () => ({
  createOpenAI: (options: Record<string, unknown>) => {
    createOpenAIOptions.push(options)
    return {
      chat: openAIChatMock,
    }
  },
}))
mock.module('@anyr/ai-sdk-provider', () => ({
  createAnyRouter: (options: Record<string, unknown>) => {
    createAnyRouterOptions.push(options)
    return (modelId: string) => anyrouterModelMock(modelId)
  },
}))
describe('createClickHouseAgent OpenRouter model resolution', () => {
  const originalFallback = process.env.OPENROUTER_FREE_FALLBACK_MODEL
  const originalAnyRouterKey = process.env.ANYROUTER_API_KEY
  const originalAppName = process.env.APP_NAME
  const originalAppSource = process.env.APP_SOURCE
  const originalAppCategory = process.env.APP_CATEGORY
  const originalAppVersion = process.env.APP_VERSION

  beforeEach(() => {
    openRouterChatMock.mockClear()
    openAIChatMock.mockClear()
    createOpenAIOptions.length = 0
    anyrouterModelMock.mockClear()
    createAnyRouterOptions.length = 0
  })

  afterEach(() => {
    if (originalFallback) {
      process.env.OPENROUTER_FREE_FALLBACK_MODEL = originalFallback
    } else {
      delete process.env.OPENROUTER_FREE_FALLBACK_MODEL
    }
    if (originalAnyRouterKey) {
      process.env.ANYROUTER_API_KEY = originalAnyRouterKey
    } else {
      delete process.env.ANYROUTER_API_KEY
    }
    if (originalAppName) {
      process.env.APP_NAME = originalAppName
    } else {
      delete process.env.APP_NAME
    }
    if (originalAppSource !== undefined) {
      process.env.APP_SOURCE = originalAppSource
    } else {
      delete process.env.APP_SOURCE
    }
    if (originalAppCategory) {
      process.env.APP_CATEGORY = originalAppCategory
    } else {
      delete process.env.APP_CATEGORY
    }
    if (originalAppVersion) {
      process.env.APP_VERSION = originalAppVersion
    } else {
      delete process.env.APP_VERSION
    }
  })

  test('maps openrouter/free to fallback tool-capable model', async () => {
    process.env.OPENROUTER_FREE_FALLBACK_MODEL = ' openai/gpt-oss-20b:free '
    const { createClickHouseAgent } = await import('../clickhouse-agent')

    createClickHouseAgent({
      hostId: 0,
      model: 'openrouter/free',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
    })

    expect(openRouterChatMock).toHaveBeenCalledWith(
      'openai/gpt-oss-20b:free',
      expect.any(Object)
    )
  })

  test('passes AnyRouter attribution headers to native provider', async () => {
    process.env.ANYROUTER_API_KEY = 'ar-test'
    process.env.APP_NAME = 'Agent Test'
    process.env.APP_SOURCE = 'agent-source'
    process.env.APP_CATEGORY = 'ops'
    process.env.APP_VERSION = 'test-version'
    const { resolveAgentChatModel } = await import('../provider-chat-model')

    resolveAgentChatModel({
      model: 'anyrouter:google/gemma-test',
      referer: 'https://example.test/agents',
    })

    expect(createAnyRouterOptions[0]).toMatchObject({
      apiKey: 'ar-test',
      baseURL: 'https://anyrouter.dev/api/v1',
      headers: {
        'HTTP-Referer': 'https://example.test/agents',
        'X-AnyRouter-Title': 'Agent Test',
        'X-AnyRouter-Source': 'agent-source',
        'X-AnyRouter-Categories': 'ops',
        'X-AnyRouter-Version': 'test-version',
      },
    })
    expect(anyrouterModelMock).toHaveBeenCalledWith('google/gemma-test')
  })

  test('attaches ephemeral cache_control for Anthropic models via AnyRouter', async () => {
    process.env.ANYROUTER_API_KEY = 'ar-test'
    const { resolveAgentChatModel } = await import('../provider-chat-model')

    resolveAgentChatModel({
      model: 'anyrouter:anthropic/claude-sonnet-4.6',
      referer: 'https://example.test/agents',
    })

    expect(createAnyRouterOptions[0]).toMatchObject({
      apiKey: 'ar-test',
      baseURL: 'https://anyrouter.dev/api/v1',
      extraBody: { cache_control: { type: 'ephemeral' } },
    })
    expect(anyrouterModelMock).toHaveBeenCalledWith(
      'anthropic/claude-sonnet-4.6'
    )
  })

  test('does not attach cache_control for non-Anthropic AnyRouter models', async () => {
    process.env.ANYROUTER_API_KEY = 'ar-test'
    const { resolveAgentChatModel } = await import('../provider-chat-model')

    resolveAgentChatModel({
      model: 'anyrouter:google/gemma-test',
      referer: 'https://example.test/agents',
    })

    expect(createAnyRouterOptions[0]).not.toHaveProperty('extraBody')
  })

  test('does not attach cache_control on the OpenAI-compatible path', async () => {
    const { resolveAgentChatModel } = await import('../provider-chat-model')

    resolveAgentChatModel({
      model: 'nvidia:anthropic/claude-sonnet-4.6',
      referer: 'https://example.test/agents',
    })

    // NVIDIA resolves through the OpenAI-compatible branch (createOpenAI); the
    // AnyRouter branch must not run, and no cache_control is set anywhere.
    expect(createAnyRouterOptions).toHaveLength(0)
    for (const options of createOpenAIOptions) {
      expect(options).not.toHaveProperty('extraBody')
    }
    expect(openAIChatMock).toHaveBeenCalledWith('anthropic/claude-sonnet-4.6')
  })

  test('falls back to the default AnyRouter source when APP_SOURCE is unset', async () => {
    process.env.ANYROUTER_API_KEY = 'ar-test'
    process.env.APP_NAME = 'Agent Test'
    delete process.env.APP_SOURCE
    process.env.APP_CATEGORY = 'ops'
    const { resolveAgentChatModel } = await import('../provider-chat-model')

    resolveAgentChatModel({
      model: 'anyrouter:google/gemma-test',
      referer: 'https://example.test/agents',
    })

    // With APP_SOURCE unset, X-AnyRouter-Source falls back to DEFAULT_APP_SOURCE
    // ('chmonitor') — the production path, since only OPENROUTER_APP_NAME is set
    // in wrangler. The category stays in X-AnyRouter-Categories.
    expect(createAnyRouterOptions[0]).toMatchObject({
      headers: {
        'X-AnyRouter-Source': 'chmonitor',
        'X-AnyRouter-Categories': 'ops',
      },
    })
  })
})
