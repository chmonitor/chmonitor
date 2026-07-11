import {
  classifyError,
  extractAgentErrorFromParts,
  parseAgentError,
} from '../errors'
import { describe, expect, test } from 'bun:test'

describe('extractAgentErrorFromParts', () => {
  const agentError = classifyError(
    { statusCode: 401, error: { message: 'Invalid API key' } },
    { model: 'openrouter:x', provider: 'openrouter' }
  )

  test('reads the AgentError out of a data-error part (array data)', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      { type: 'data-error', data: [agentError] },
    ]
    expect(extractAgentErrorFromParts(parts)).toEqual(agentError)
  })

  test('reads the AgentError out of a data-error part (object data)', () => {
    const parts = [{ type: 'data-error', data: agentError }]
    expect(extractAgentErrorFromParts(parts)).toEqual(agentError)
  })

  test('returns null when there is no data-error part', () => {
    expect(
      extractAgentErrorFromParts([{ type: 'text', text: 'ok' }])
    ).toBeNull()
    expect(extractAgentErrorFromParts([])).toBeNull()
    expect(extractAgentErrorFromParts(undefined)).toBeNull()
  })

  test('ignores a malformed data-error payload', () => {
    const parts = [{ type: 'data-error', data: [{ nope: true }] }]
    expect(extractAgentErrorFromParts(parts)).toBeNull()
  })
})

describe('agent error classification', () => {
  test('extracts AnyRouter upstream envelope details', () => {
    const classified = classifyError(
      {
        statusCode: 502,
        responseBody: JSON.stringify({
          error: {
            code: 'upstream_exhausted',
            message: 'Every upstream provider failed',
            metadata: {
              type: 'upstream_error',
              upstream_backend: 'cloudflare',
              upstream_status: 502,
              upstream_message: 'Worker AI backend unavailable',
            },
          },
        }),
        response: {
          headers: new Headers({ 'x-request-id': 'req_anyrouter_123' }),
        },
      },
      { model: 'anyrouter:google/gemma-4-26b-a4b-it', provider: 'anyrouter' }
    )

    expect(classified).toMatchObject({
      type: 'upstream_error',
      provider: 'anyrouter',
      model: 'anyrouter:google/gemma-4-26b-a4b-it',
      code: 'upstream_exhausted',
      upstreamBackend: 'cloudflare',
      upstreamStatus: 502,
      upstreamMessage: 'Worker AI backend unavailable',
      requestId: 'req_anyrouter_123',
    })
  })

  test('keeps upstream payment details on billing errors', () => {
    const classified = classifyError(
      JSON.stringify({
        error: {
          code: 'payment_required',
          message: 'Upstream provider "cloudflare" returned 402',
          metadata: {
            upstream_backend: 'cloudflare',
            upstream_status: 402,
            upstream_message: 'You exceeded your current quota.',
          },
        },
      }),
      { provider: 'anyrouter' }
    )

    expect(classified.type).toBe('billing_error')
    expect(classified.code).toBe('payment_required')
    expect(classified.upstreamMessage).toBe('You exceeded your current quota.')
  })

  test('parses nested AgentError client payloads', () => {
    const error = new Error(
      JSON.stringify({
        error: {
          type: 'upstream_error',
          message: 'Provider unavailable',
          suggestion: 'Retry later',
          timestamp: 123,
        },
      })
    )

    expect(parseAgentError(error)).toMatchObject({
      type: 'upstream_error',
      message: 'Provider unavailable',
    })
  })

  // The agent route's outermost boundary passes any uncaught throw through
  // classifyError. Whatever escapes must still become a renderable AgentError
  // (round-trippable via parseAgentError) instead of an opaque HTML 500.
  test('classifies an arbitrary uncaught throw into a renderable AgentError', () => {
    const classified = classifyError(
      new Error('Cannot read properties of undefined')
    )

    expect(classified.type).toBe('unknown')
    expect(classified.message).toBe('Cannot read properties of undefined')
    expect(typeof classified.suggestion).toBe('string')
    expect(classified.suggestion.length).toBeGreaterThan(0)
    expect(typeof classified.timestamp).toBe('number')

    // The boundary serialises `{ error: classified }`; the client re-parses it.
    const roundTripped = parseAgentError(
      new Error(JSON.stringify({ error: classified }))
    )
    expect(roundTripped).toMatchObject({
      type: 'unknown',
      message: 'Cannot read properties of undefined',
    })
  })
})
