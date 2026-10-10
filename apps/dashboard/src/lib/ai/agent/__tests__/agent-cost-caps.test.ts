// @ts-nocheck
/**
 * Cost caps: every model step gets an output-token cap and the tool loop
 * stops at DEFAULT_MAX_STEPS, so a wandering agent cannot run up the bill.
 */
import { describe, expect, mock, test } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'

mock.module('server-only', () => ({}))
mock.module('@chm/sql-builder', () => ({ validateSqlQuery: () => {} }))
mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({ data: [], error: null }),
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),
}))

const { createClickHouseAgent, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_STEPS } =
  await import('../clickhouse-agent')

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

describe('agent cost caps', () => {
  test('passes the default maxOutputTokens to the model', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
        usage: USAGE,
        warnings: [],
      },
    })
    await createClickHouseAgent({ hostId: 0, model }).generate({
      prompt: 'hi',
    })
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(4096)
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(4096)
  })

  test('stops a model that never stops calling tools at DEFAULT_MAX_STEPS', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'c',
            toolName: 'get_metrics',
            input: '{}',
          },
        ],
        finishReason: 'tool-calls',
        usage: USAGE,
        warnings: [],
      }),
    })
    const result = await createClickHouseAgent({ hostId: 0, model }).generate({
      prompt: 'loop',
    })
    expect(DEFAULT_MAX_STEPS).toBe(10)
    expect(model.doGenerateCalls.length).toBe(10)
    expect(result.steps.length).toBe(10)
  })
})
