import { isValidAgentApiBearerToken } from './agent-api-token'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/v1/test', { headers })
}

const originalAgentApiToken = process.env.AGENT_API_TOKEN

beforeEach(() => {
  delete process.env.AGENT_API_TOKEN
})

afterEach(() => {
  if (originalAgentApiToken === undefined) {
    delete process.env.AGENT_API_TOKEN
  } else {
    process.env.AGENT_API_TOKEN = originalAgentApiToken
  }
})

describe('isValidAgentApiBearerToken', () => {
  test('rejects when AGENT_API_TOKEN is unset', async () => {
    const request = makeRequest({ authorization: 'Bearer anything' })
    expect(await isValidAgentApiBearerToken(request)).toBe(false)
  })

  test('rejects when no Authorization header is provided', async () => {
    process.env.AGENT_API_TOKEN = 'correct-token'
    const request = makeRequest()
    expect(await isValidAgentApiBearerToken(request)).toBe(false)
  })

  test('rejects a wrong bearer token', async () => {
    process.env.AGENT_API_TOKEN = 'correct-token'
    const request = makeRequest({ authorization: 'Bearer wrong-token' })
    expect(await isValidAgentApiBearerToken(request)).toBe(false)
  })

  test('accepts the correct bearer token', async () => {
    process.env.AGENT_API_TOKEN = 'correct-token'
    const request = makeRequest({ authorization: 'Bearer correct-token' })
    expect(await isValidAgentApiBearerToken(request)).toBe(true)
  })
})
