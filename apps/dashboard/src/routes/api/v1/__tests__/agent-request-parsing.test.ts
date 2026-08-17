/**
 * Unit tests for `parseAgentRequest` — the input-shaping phase of
 * POST /api/v1/agent extracted in issue #2885.
 *
 * These limits are the endpoint's first line of defence: a caller must not be
 * able to push an unbounded body, an unbounded history, or unbounded text into
 * the model. Each test asserts the *reason* a request is rejected (which the
 * route maps 1:1 onto its HTTP status), not just that it failed, so a future
 * change that silently widens a cap fails here.
 */

import {
  AGENT_MAX_MESSAGES,
  AGENT_MAX_PART_TEXT_LENGTH,
  AGENT_MAX_REQUEST_SIZE_BYTES,
  AGENT_MAX_USER_MESSAGE_LENGTH,
  hardenGuestAgentRequest,
  parseAgentRequest,
} from '../-agent/request-parsing'
import { describe, expect, test } from 'bun:test'

function postRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('https://example.com/api/v1/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('parseAgentRequest', () => {
  test('accepts a valid request and exposes the shaped fields', async () => {
    const result = await parseAgentRequest(
      postRequest({
        message: 'why is my cluster slow?',
        hostId: '2',
        sessionId: 'session-1',
        disabledTools: ['kill_query', 42],
        pageContext: { route: '/merges', label: 'Merges' },
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.userMessage).toBe('why is my cluster slow?')
    expect(result.hostId).toBe(2)
    expect(result.sessionId).toBe('session-1')
    // Non-string entries are dropped rather than passed through to the agent.
    expect(result.disabledTools).toEqual(['kill_query'])
    expect(result.pageContext).toEqual({ route: '/merges', label: 'Merges' })
  })

  test('rejects a body whose declared content-length exceeds the cap', async () => {
    const result = await parseAgentRequest(
      postRequest(
        { message: 'hi' },
        { 'content-length': String(AGENT_MAX_REQUEST_SIZE_BYTES + 1) }
      )
    )

    expect(result).toEqual({ ok: false, reason: 'payload_too_large' })
  })

  test('rejects an oversized body streamed without a content-length', async () => {
    // The cap must also hold while the body is read, otherwise a chunked
    // request with no (or a lying) content-length bypasses it.
    const oversized = new TextEncoder().encode(
      JSON.stringify({ message: 'x'.repeat(AGENT_MAX_REQUEST_SIZE_BYTES) })
    )
    const request = new Request('https://example.com/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(oversized)
          controller.close()
        },
      }),
      // Required by the fetch spec for a streaming request body.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const result = await parseAgentRequest(request)

    expect(result).toEqual({ ok: false, reason: 'payload_too_large' })
  })

  test('rejects a non-JSON body', async () => {
    const result = await parseAgentRequest(postRequest('{not json'))

    expect(result).toEqual({ ok: false, reason: 'invalid_json' })
  })

  test('rejects more than AGENT_MAX_MESSAGES messages', async () => {
    const messages = Array.from({ length: AGENT_MAX_MESSAGES + 1 }, () => ({
      role: 'user',
      content: 'hello',
    }))

    const result = await parseAgentRequest(postRequest({ messages }))

    expect(result).toEqual({ ok: false, reason: 'too_many_messages' })
  })

  test('rejects a history that sanitizes down to nothing', async () => {
    const result = await parseAgentRequest(
      postRequest({ messages: [{ role: 'user' }, { nope: true }] })
    )

    expect(result).toEqual({ ok: false, reason: 'no_valid_messages' })
  })

  test('rejects a request with no usable message text', async () => {
    const result = await parseAgentRequest(postRequest({ message: '   ' }))

    expect(result).toEqual({ ok: false, reason: 'message_required' })
  })

  test('truncates an over-long top-level user message instead of failing', async () => {
    const result = await parseAgentRequest(
      postRequest({ message: 'a'.repeat(AGENT_MAX_USER_MESSAGE_LENGTH + 500) })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.userMessage?.length).toBe(AGENT_MAX_USER_MESSAGE_LENGTH)
  })

  test('truncates over-long message part text', async () => {
    const result = await parseAgentRequest(
      postRequest({
        messages: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: 'b'.repeat(AGENT_MAX_PART_TEXT_LENGTH + 99),
              },
            ],
          },
        ],
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.userMessage?.length).toBe(AGENT_MAX_PART_TEXT_LENGTH)
  })

  test('caps message parts at AGENT_MAX_MESSAGE_PARTS', async () => {
    const parts = Array.from({ length: 100 }, (_, i) => ({
      type: 'text',
      text: `part-${i}`,
    }))

    const result = await parseAgentRequest(
      postRequest({ messages: [{ role: 'user', parts }] })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.safeIncomingMessages[0].parts).toHaveLength(64)
  })

  test('drops malformed custom MCP servers and caps the list at five', async () => {
    const mcpServers = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      name: `server-${i}`,
      endpoint: `https://mcp.example.com/${i}`,
    }))
    mcpServers[0] = { id: 1 as never, name: 'bad', endpoint: 'x' }

    const result = await parseAgentRequest(
      postRequest({ message: 'hi', mcpServers })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mcpServers).toHaveLength(4)
  })

  test('hardenGuestAgentRequest strips BYOK, MCP, and expensive models', async () => {
    const result = await parseAgentRequest(
      postRequest({
        message: 'hello',
        apiKey: 'sk-guest-must-not-use-this',
        model: 'openai:gpt-4o',
        mcpServers: [
          {
            id: 'evil',
            name: 'evil',
            endpoint: 'https://mcp.example.com',
          },
        ],
        hostId: -3,
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const hardened = hardenGuestAgentRequest(result)
    expect(hardened.byokApiKey).toBeNull()
    expect(hardened.mcpServers).toEqual([])
    expect(hardened.body.apiKey).toBeUndefined()
    expect(hardened.body.model).toBe('anyrouter:auto')
    expect(hardened.hostId).toBe(0)
  })

  test('hardenGuestAgentRequest keeps anyrouter:auto', async () => {
    const result = await parseAgentRequest(
      postRequest({ message: 'hello', model: 'anyrouter:auto' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(hardenGuestAgentRequest(result).body.model).toBe('anyrouter:auto')
  })
})
