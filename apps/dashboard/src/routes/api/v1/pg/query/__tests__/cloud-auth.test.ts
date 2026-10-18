/**
 * In cloud mode the Postgres query route needs a signed-in caller; on
 * self-hosted anonymous callers keep working.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const { __handlePostForTests: handlePost } = await import('../$name')

const KEYS = [
  'CHM_CLOUD_MODE',
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

// Invalid JSON ends the handler before any network I/O.
const req = () =>
  new Request('https://dash.example.com/api/v1/pg/query/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })

describe('pg/query cloud-mode sign-in', () => {
  test('anonymous cloud request is rejected with 401', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    const res = await handlePost(req(), 'x')
    expect(res.status).toBe(401)
    expect((await res.json()) as unknown).toEqual({
      success: false,
      error: { type: 'permission_error', message: 'Authentication required' },
    })
  })

  test('self-hosted anonymous request is not auth-gated', async () => {
    const res = await handlePost(req(), 'x')
    expect(res.status).not.toBe(401)
  })

  test('self-hosted clerk anonymous request is not auth-gated', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    const res = await handlePost(req(), 'x')
    expect(res.status).not.toBe(401)
  })
})
