/**
 * In cloud mode a Slack install must belong to a signed-in owner, so an
 * anonymous caller gets 401. Self-hosted installs keep working without auth.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const { __handleGetForTests: handleGet } = await import('./install')

const KEYS = [
  'CHM_CLOUD_MODE',
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  process.env.SLACK_CLIENT_ID = 'test-client-id'
  process.env.SLACK_CLIENT_SECRET = 'test-client-secret'
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const req = () => new Request('https://dash.example.com/api/v1/slack/install')

describe('slack/install sign-in', () => {
  test('anonymous cloud request is rejected with 401, not sent to Slack', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    const res = await handleGet(req())
    expect(res.status).toBe(401)
    expect(res.headers.get('Location')).toBeNull()
    expect((await res.json()) as unknown).toEqual({
      error: 'Authentication required',
    })
  })

  test('unconfigured Slack app still answers 501 in cloud mode', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    delete process.env.SLACK_SIGNING_SECRET
    const res = await handleGet(req())
    expect(res.status).toBe(501)
  })

  test('self-hosted anonymous request redirects to Slack', async () => {
    const res = await handleGet(req())
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toStartWith(
      'https://slack.com/oauth/v2/authorize'
    )
  })
})
