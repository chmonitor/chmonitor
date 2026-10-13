/**
 * Route-level auth tests for POST /api/v1/slack/interactions (#3808). Mirrors
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

const ROUTE_URL = 'https://dash.example.dev/api/v1/slack/interactions'
const FORM_CT = 'application/x-www-form-urlencoded'
const body = new URLSearchParams({
  payload: JSON.stringify({ type: 'view_submission' }),
}).toString()

async function signed(raw: string): Promise<Request> {
  const { computeSlackSignature } = await import('@/lib/slack/verify-signature')
  const ts = String(Math.floor(Date.now() / 1000))
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: {
      'content-type': FORM_CT,
      'x-slack-signature': await computeSlackSignature(SECRET, ts, raw),
      'x-slack-request-timestamp': ts,
    },
    body: raw,
  })
}

function badSignature(raw: string): Request {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: {
      'content-type': FORM_CT,
      'x-slack-signature': 'v0=deadbeef',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: raw,
  })
}

describe('POST /api/v1/slack/interactions', () => {
  test('unconfigured -> 501 (fail closed)', async () => {
    configure(false)
    const { __handlePostForTests } = await import('./interactions')
    const res = await __handlePostForTests(await signed(body))
    expect(res.status).toBe(501)
  })

  test('invalid signature -> 401', async () => {
    const { __handlePostForTests } = await import('./interactions')
    const res = await __handlePostForTests(badSignature(body))
    expect(res.status).toBe(401)
  })

  test('validly signed non-block_actions payload -> empty 200', async () => {
    const { __handlePostForTests } = await import('./interactions')
    const res = await __handlePostForTests(await signed(body))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  test('validly signed body without payload field -> empty 200', async () => {
    const { __handlePostForTests } = await import('./interactions')
    const res = await __handlePostForTests(await signed('foo=bar'))
    expect(res.status).toBe(200)
  })
})
