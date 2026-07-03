/**
 * Route-level tests for the /chmonitor slash command (plans/37).
 *
 * Exercises the real inbound auth path end-to-end (readAndVerifySlackRequest →
 * verifySlackRequest with real HMAC) via the exported test handler, using real
 * env (config reads process.env live) so no mocking of the security core is
 * needed. Only the CH-free `help` path is driven so the test needs no
 * ClickHouse — the query/status/alert data paths are covered by their own pure
 * builders' tests.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const SECRET = 'route-signing-secret'

const saved = {
  id: process.env.SLACK_CLIENT_ID,
  secret: process.env.SLACK_CLIENT_SECRET,
  signing: process.env.SLACK_SIGNING_SECRET,
}

function configure(on: boolean): void {
  if (on) {
    process.env.SLACK_CLIENT_ID = 'client-id'
    process.env.SLACK_CLIENT_SECRET = 'client-secret'
    process.env.SLACK_SIGNING_SECRET = SECRET
  } else {
    delete process.env.SLACK_CLIENT_ID
    delete process.env.SLACK_CLIENT_SECRET
    delete process.env.SLACK_SIGNING_SECRET
  }
}

beforeEach(() => configure(true))
afterEach(() => {
  // Restore original env so other suites stay isolated.
  for (const [k, v] of [
    ['SLACK_CLIENT_ID', saved.id],
    ['SLACK_CLIENT_SECRET', saved.secret],
    ['SLACK_SIGNING_SECRET', saved.signing],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function signedRequest(text: string): Promise<Request> {
  const { computeSlackSignature } = await import('@/lib/slack/verify-signature')
  const body = new URLSearchParams({ command: '/chmonitor', text }).toString()
  const ts = String(Math.floor(Date.now() / 1000))
  const signature = await computeSlackSignature(SECRET, ts, body)
  return new Request('https://dash.example.dev/api/v1/slack/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': ts,
    },
    body,
  })
}

describe('POST /api/v1/slack/commands', () => {
  test('unconfigured → 501 (fail closed)', async () => {
    configure(false)
    const { __handlePostForTests } = await import('./commands')
    const res = await __handlePostForTests(await signedRequest(''))
    expect(res.status).toBe(501)
  })

  test('invalid signature → 401', async () => {
    const { __handlePostForTests } = await import('./commands')
    const body = new URLSearchParams({ text: 'help' }).toString()
    const req = new Request('https://dash.example.dev/api/v1/slack/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': 'v0=deadbeef',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body,
    })
    const res = await __handlePostForTests(req)
    expect(res.status).toBe(401)
  })

  test('validly-signed help command → 200 ephemeral blocks', async () => {
    const { __handlePostForTests } = await import('./commands')
    const res = await __handlePostForTests(await signedRequest(''))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      response_type: string
      blocks: unknown[]
    }
    expect(json.response_type).toBe('ephemeral')
    expect(Array.isArray(json.blocks)).toBe(true)
    expect(JSON.stringify(json.blocks)).toContain('/chmonitor status')
  })
})
