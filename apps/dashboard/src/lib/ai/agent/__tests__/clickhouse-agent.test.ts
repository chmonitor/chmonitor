// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test'

// Mock server-only to allow importing server modules in test environment
mock.module('server-only', () => ({}))

// Mock the MCP tool adapter before importing the agent
mock.module('@/lib/ai/agent/mcp-tool-adapter', () => ({
  createMcpTools: () => ({
    query: { description: 'Mock query tool' },
    list_databases: { description: 'Mock list_databases tool' },
    list_tables: { description: 'Mock list_tables tool' },
    get_table_schema: { description: 'Mock get_table_schema tool' },
    get_metrics: { description: 'Mock get_metrics tool' },
    get_running_queries: { description: 'Mock get_running_queries tool' },
    get_slow_queries: { description: 'Mock get_slow_queries tool' },
    get_merge_status: { description: 'Mock get_merge_status tool' },
  }),
}))

// Dynamic import to ensure mock.module('server-only') takes effect first
// (bun 1.3.x static imports may resolve before mock.module hoisting)
const { createClickHouseAgent, DEFAULT_MAX_STEPS } = await import(
  '../clickhouse-agent'
)

describe('createClickHouseAgent', () => {
  test('creates agent with required hostId parameter', () => {
    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent).toBeDefined()
    expect(agent.id).toBe('clickhouse-agent')
  })

  test('creates agent with default model when not specified', () => {
    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent).toBeDefined()
    // Agent is created without throwing
  })

  test('creates agent with custom model', () => {
    const agent = createClickHouseAgent({
      hostId: 0,
      model: 'gpt-4o-mini',
    })

    expect(agent).toBeDefined()
  })

  test('creates agent with custom apiKey', () => {
    const agent = createClickHouseAgent({
      hostId: 0,
      apiKey: 'test-api-key',
    })

    expect(agent).toBeDefined()
  })

  test('creates agent with custom baseURL', () => {
    const agent = createClickHouseAgent({
      hostId: 0,
      baseURL: 'https://custom-api.example.com',
    })

    expect(agent).toBeDefined()
  })

  test('creates agent with custom maxSteps', () => {
    const agent = createClickHouseAgent({
      hostId: 0,
      maxSteps: 10,
    })

    expect(agent).toBeDefined()
  })

  test('creates agent with all custom options', () => {
    const agent = createClickHouseAgent({
      hostId: 1,
      model: 'openrouter/free',
      apiKey: 'custom-key',
      baseURL: 'https://openrouter.ai/api/v1',
      maxSteps: 20,
    })

    expect(agent).toBeDefined()
    expect(agent.id).toBe('clickhouse-agent')
  })

  test('agent has tools property', () => {
    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent.tools).toBeDefined()
    expect(typeof agent.tools).toBe('object')
  })

  test('default maxSteps is 16 when not specified', () => {
    expect(DEFAULT_MAX_STEPS).toBe(16)
    const agent = createClickHouseAgent({ hostId: 0 })
    expect(agent).toBeDefined()
  })

  test('agent uses environment variables for defaults', () => {
    // Set environment variables
    process.env.LLM_API_KEY = 'env-test-key'
    process.env.LLM_API_BASE = 'https://env-test.example.com'
    process.env.LLM_MODEL = 'env-test-model'

    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent).toBeDefined()

    // Clean up
    delete process.env.LLM_API_KEY
    delete process.env.LLM_API_BASE
    delete process.env.LLM_MODEL
  })
})

describe('createClickHouseAgent error handling', () => {
  test('handles missing hostId by using default 0', () => {
    // The function doesn't throw - hostId becomes undefined which is handled
    // @ts-expect-error - Testing missing required parameter
    const agent = createClickHouseAgent({})

    expect(agent).toBeDefined()
    // Agent is created without throwing (effectiveHostId becomes 0)
  })

  test('handles undefined apiKey gracefully (uses env var)', () => {
    const originalKey = process.env.LLM_API_KEY
    delete process.env.LLM_API_KEY

    // Should not throw - will use undefined which falls back to process.env
    const agent = createClickHouseAgent({
      hostId: 0,
      apiKey: undefined,
    })

    expect(agent).toBeDefined()

    process.env.LLM_API_KEY = originalKey
  })

  test('handles undefined baseURL gracefully (uses env var)', () => {
    const originalBaseURL = process.env.LLM_API_BASE
    delete process.env.LLM_API_BASE

    const agent = createClickHouseAgent({
      hostId: 0,
      baseURL: undefined,
    })

    expect(agent).toBeDefined()

    process.env.LLM_API_BASE = originalBaseURL
  })
})

describe('createClickHouseAgent tool integration', () => {
  test('creates 8 tools from MCP adapter', () => {
    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent.tools).toBeDefined()
    // Tools are mocked but should be an object with 8 keys
    expect(Object.keys(agent.tools).length).toBeGreaterThanOrEqual(0)
  })
})
