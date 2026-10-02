/**
 * The agent's SSE response must carry at most one text-delta event per model
 * text delta. Wiring plain `pipeJsonRender` back in splits every delta into
 * one event per character, and the per-event work (UI-message state, JSON,
 * encoding) pushed /api/v1/agent past the Workers CPU limit (#3560).
 */
import { createAgentStreamResponse } from './stream'
import { describe, expect, test } from 'bun:test'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { createClickHouseAgent } from '@/lib/ai/agent'

const DELTAS = ['The server ', 'runs ClickHouse ', '25.3, ', 'uptime 4 days.']

function mockModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't' },
          ...DELTAS.map((delta) => ({ type: 'text-delta', id: 't', delta })),
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          },
        ] as never[],
      }),
    }),
  })
}

describe('createAgentStreamResponse', () => {
  test('streams one SSE text-delta per model delta, not per character', async () => {
    const response = createAgentStreamResponse({
      agent: createClickHouseAgent({ hostId: 0, model: mockModel() }),
      mcpCloseAll: null,
      uiMessages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'version?' }] },
      ],
      userMessage: 'version?',
      model: 'openrouter:openrouter/free',
      requestedProvider: 'openrouter',
      billingOwnerId: null,
      resolvedPlan: null,
      releaseReservationOnce: async () => {},
    })

    const events = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice('data: '.length)))
    const textDeltas = events.filter((e) => e.type === 'text-delta')

    expect(textDeltas.map((e) => e.delta).join('')).toBe(DELTAS.join(''))
    expect(textDeltas.length).toBeLessThanOrEqual(DELTAS.length)
  })
})
