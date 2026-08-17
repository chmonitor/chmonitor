// @ts-nocheck — AI SDK generics (ToolLoopAgent / MockLanguageModelV3) are not
// worth fighting in test code; matches the convention in the sibling
// `scenarios.test.ts` / `clickhouse-agent.test.ts`.
/**
 * Regression tests for `createAgentStreamResponse` (POST /api/v1/agent):
 *
 * 1. The first message of a brand-new session must actually produce an
 *    assistant reply. `buildUiMessages` (runtime.ts) threads a "the user is
 *    viewing page X" hint ahead of the user's turn, but only on the first
 *    turn of a thread (the client only sends `pageContext` then). That hint
 *    used to be injected as a `role: 'system'` UIMessage — but the AI SDK's
 *    `ToolLoopAgent`/`streamText` reject any `system`-role entry inside
 *    `messages` (`allowSystemInMessages` defaults to `false` in
 *    `standardizePrompt`), throwing `AI_InvalidPromptError` and turning the
 *    very first reply of every new session into a dead stream instead of a
 *    real answer — while every later message (no `pageContext`) worked fine.
 *    Fixed by threading the hint in as `role: 'user'` instead.
 *
 * 2. A thrown tool error must reach the client with its real message, not the
 *    AI SDK's generic, safe-by-default "An error occurred." `errorText` —
 *    `result.toUIMessageStream()` was called with no `onError`, so both its
 *    `error` and `tool-error` chunk cases fell back to that mask.
 */
import { describe, expect, mock, test } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'

mock.module('server-only', () => ({}))
mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => {},
  getAllSqlStrings: (sql: unknown) =>
    Array.isArray(sql) ? sql.map((s: { sql: string }) => s.sql) : [sql],
}))
mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({ data: [], error: null }),
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),
}))

const { createClickHouseAgent } = await import('../clickhouse-agent')
const { buildUiMessages } = await import(
  '../../../../routes/api/v1/-agent/runtime'
)
const { createAgentStreamResponse } = await import(
  '../../../../routes/api/v1/-agent/stream'
)
const { ToolLoopAgent, isStepCount, tool } = await import('ai')
const { z } = await import('zod')

const STREAM_USAGE = { inputTokens: 5, outputTokens: 5, totalTokens: 10 }

/** A scripted `doStream` result that emits a single plain-text reply. */
function textStreamResult(text: string) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.enqueue({ type: 'text-start', id: '1' })
        controller.enqueue({ type: 'text-delta', id: '1', delta: text })
        controller.enqueue({ type: 'text-end', id: '1' })
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          usage: STREAM_USAGE,
        })
        controller.close()
      },
    }),
  }
}

/** A scripted `doStream` result that calls the given tool, then never
 * produces a text reply — mirroring a tool whose failure ends the turn. */
function toolCallStreamResult(
  toolName: string,
  finishReason: string = 'tool-calls'
) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName,
          input: '{}',
        })
        controller.enqueue({
          type: 'finish',
          finishReason,
          usage: STREAM_USAGE,
        })
        controller.close()
      },
    }),
  }
}

async function readSseBody(response: Response): Promise<string> {
  return await response.text()
}

/** Parse an SSE UI-message-stream body into its `data:` JSON chunks. */
function parseSseChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .filter((json) => json !== '[DONE]')
    .map((json) => JSON.parse(json))
}

/** Reassemble the streamed assistant text from `text-delta` chunks — the AI
 * SDK smooth-streams text one token/character at a time, so a literal
 * substring match against the raw SSE body is unreliable. */
function assembleText(chunks: Array<Record<string, unknown>>): string {
  return chunks
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.delta as string)
    .join('')
}

function baseStreamOptions() {
  return {
    userMessage: 'hi',
    model: 'test/mock',
    requestedProvider: 'test',
    billingOwnerId: null,
    resolvedPlan: null,
    releaseReservationOnce: async () => {},
  }
}

describe('createAgentStreamResponse — first message of a new session', () => {
  test('streams a real reply when pageContext is present on the first turn', async () => {
    const model = new MockLanguageModelV3({
      doStream: [textStreamResult('Hello! How can I help?')],
    })
    const agent = createClickHouseAgent({ hostId: 0, model })

    // Mirrors exactly what the route builds for a brand-new session's first
    // request: one user message + a client-supplied `pageContext` hint.
    const uiMessages = buildUiMessages({
      safeIncomingMessages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
      userMessage: 'hi',
      pageContext: { route: '/merges', label: 'Merges' },
      hostId: 0,
    })

    const response = createAgentStreamResponse({
      ...baseStreamOptions(),
      agent,
      mcpCloseAll: null,
      uiMessages,
    })

    const body = await readSseBody(response)
    const chunks = parseSseChunks(body)

    // Before the fix this was a short `data-error`/`error` stream with zero
    // assistant text (AI_InvalidPromptError from the injected system-role
    // message) — assert the real reply text actually made it through.
    expect(assembleText(chunks)).toBe('Hello! How can I help?')
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    expect(chunks.some((c) => c.type === 'data-error')).toBe(false)
  })

  test('the pageContext hint is not injected as a disallowed system-role message', () => {
    const uiMessages = buildUiMessages({
      safeIncomingMessages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
      userMessage: 'hi',
      pageContext: { route: '/merges', label: 'Merges' },
      hostId: 0,
    })

    expect(uiMessages.some((m) => m.role === 'system')).toBe(false)
    expect(
      uiMessages.some(
        (m) =>
          m.role === 'user' &&
          m.parts.some(
            (p) =>
              typeof p === 'object' &&
              p !== null &&
              'text' in p &&
              typeof p.text === 'string' &&
              p.text.includes('viewing the "Merges" page')
          )
      )
    ).toBe(true)
  })
})

describe('createAgentStreamResponse — tool loop continues after first tool', () => {
  test('streams a follow-up answer when the first step is a tool call with finishReason stop', async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStreamResult('list_databases', 'stop'),
        textStreamResult('default has the most tables.'),
      ],
    })
    const agent = createClickHouseAgent({ hostId: 0, model })

    const uiMessages = buildUiMessages({
      safeIncomingMessages: [
        {
          id: 'u1',
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'What databases are available and which ones have the most tables?',
            },
          ],
        },
      ],
      userMessage:
        'What databases are available and which ones have the most tables?',
      pageContext: undefined,
      hostId: 0,
    })

    const response = createAgentStreamResponse({
      ...baseStreamOptions(),
      agent,
      mcpCloseAll: null,
      uiMessages,
      userMessage:
        'What databases are available and which ones have the most tables?',
    })

    const body = await readSseBody(response)
    const chunks = parseSseChunks(body)

    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    expect(chunks.some((c) => c.type === 'data-error')).toBe(false)
    expect(assembleText(chunks)).toContain('default has the most tables')
    expect(
      chunks.some(
        (c) =>
          c.type === 'tool-input-available' ||
          c.type === 'tool-call' ||
          c.toolName === 'list_databases'
      )
    ).toBe(true)
  })
})

describe('createAgentStreamResponse — error surfacing', () => {
  test('a thrown tool error reaches the client with its real message, not "An error occurred."', async () => {
    const failingTool = tool({
      description: 'Always fails, for testing error surfacing.',
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('ClickHouse connection refused: too many connections')
      },
    })

    const model = new MockLanguageModelV3({
      doStream: [toolCallStreamResult('always_fails')],
    })
    const agent = new ToolLoopAgent({
      id: 'test-agent',
      model,
      tools: { always_fails: failingTool },
      instructions: 'test',
      stopWhen: isStepCount(1),
    })

    const uiMessages = buildUiMessages({
      safeIncomingMessages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
      userMessage: 'hi',
      pageContext: undefined,
      hostId: 0,
    })

    const response = createAgentStreamResponse({
      ...baseStreamOptions(),
      agent,
      mcpCloseAll: null,
      uiMessages,
    })

    const body = await readSseBody(response)
    const chunks = parseSseChunks(body)
    const errorChunks = chunks.filter(
      (c) => c.type === 'error' || c.type === 'tool-output-error'
    )

    expect(errorChunks.length).toBeGreaterThan(0)
    for (const chunk of errorChunks) {
      expect(chunk.errorText).not.toBe('An error occurred.')
    }
    expect(
      errorChunks.some((c) =>
        String(c.errorText).includes('ClickHouse connection refused')
      )
    ).toBe(true)
  })

  test('a redacted secret never reaches the client in an error message', async () => {
    const secretKey = 'sk-super-secret-value-1234567890'
    const failingTool = tool({
      description: 'Fails with a message that echoes a credential.',
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error(
          `Upstream call failed: Authorization: Bearer ${secretKey}`
        )
      },
    })

    const model = new MockLanguageModelV3({
      doStream: [toolCallStreamResult('leaky_tool')],
    })
    const agent = new ToolLoopAgent({
      id: 'test-agent',
      model,
      tools: { leaky_tool: failingTool },
      instructions: 'test',
      stopWhen: isStepCount(1),
    })

    const uiMessages = buildUiMessages({
      safeIncomingMessages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
      userMessage: 'hi',
      pageContext: undefined,
      hostId: 0,
    })

    const response = createAgentStreamResponse({
      ...baseStreamOptions(),
      agent,
      mcpCloseAll: null,
      uiMessages,
      byokApiKey: secretKey,
    })

    const body = await readSseBody(response)

    expect(body).not.toContain(secretKey)
    expect(body).toContain('Upstream call failed')
  })
})
