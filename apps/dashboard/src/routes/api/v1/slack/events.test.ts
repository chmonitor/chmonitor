/**
 * Route-level auth tests for POST /api/v1/slack/events (#3808). Mirrors
 * commands.test.ts: real HMAC verification via the exported test handler.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const SECRET = 'route-signing-secret'
const KEYS = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET']
const saved: Record<string, string | undefined> = {}

function configure(on: boolean): void {
  if (on) {
    process.env.SLACK_CLIENT_ID = 'client-id'
    process.env.SLACK_CLIENT_SECRET = 'client-secret'
    process.env.SLACK_SIGNING_SECRET = SECRET
  } else {
    for (const k of KEYS) delete process.env[k]
  }
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  configure(true)
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const ROUTE_URL = 'https://dash.example.dev/api/v1/slack/events'
const JSON_CT = 'application/json'
const challengeBody = JSON.stringify({
  type: 'url_verification',
  challenge: 'abc123',
})

async function signed(body: string): Promise<Request> {
  const { computeSlackSignature } = await import('@/lib/slack/verify-signature')
  const ts = String(Math.floor(Date.now() / 1000))
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: {
      'content-type': JSON_CT,
      'x-slack-signature': await computeSlackSignature(SECRET, ts, body),
      'x-slack-request-timestamp': ts,
    },
    body,
  })
}

function badSignature(body: string): Request {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: {
      'content-type': JSON_CT,
      'x-slack-signature': 'v0=deadbeef',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body,
  })
}

describe('POST /api/v1/slack/events', () => {
  test('unconfigured -> 501 (fail closed)', async () => {
    configure(false)
    const { __handlePostForTests } = await import('./events')
    const res = await __handlePostForTests(await signed(challengeBody))
    expect(res.status).toBe(501)
  })

  test('invalid signature -> 401 and the challenge is not echoed', async () => {
    const { __handlePostForTests } = await import('./events')
    const res = await __handlePostForTests(badSignature(challengeBody))
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('abc123')
  })

  test('validly signed url_verification echoes the challenge', async () => {
    const { __handlePostForTests } = await import('./events')
    const res = await __handlePostForTests(await signed(challengeBody))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
  })

  test('validly signed malformed JSON -> 400', async () => {
    const { __handlePostForTests } = await import('./events')
    const res = await __handlePostForTests(await signed('{not json'))
    expect(res.status).toBe(400)
  })
})
