/**
 * The MCP server registry holds per-user secrets, so every method must reject
 * an anonymous caller when the dashboard runs Clerk with public read enabled
 * (cloud mode), while an auth-`none` self-hosted deploy keeps working.
 * Uses the real isAuthenticatedRequest (no guard mock) so a handler that forgets
 * to call it fails here.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as apiGuard from '@/lib/auth/api-guard'

const { __guardedHandlersForTests: handlers } = await import('../servers')
const { __handlePostForTests: probePost } = await import('../servers/$id/probe')

const KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_API_KEY_SECRET',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function cloudMode() {
  process.env.CHM_AUTH_PROVIDER = 'clerk'
  process.env.CHM_CLERK_PUBLIC_READ = 'true'
}

const url = 'https://dash.example.com/api/v1/mcp/servers'
const withBody = (method: string) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'x' }),
  })

describe('mcp servers auth guard', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
    test(`${method} rejects an anonymous cloud-mode caller`, async () => {
      cloudMode()
      const req =
        method === 'GET' || method === 'DELETE'
          ? new Request(`${url}?id=x`, { method })
          : withBody(method)
      const res = await handlers[method](req)
      expect(res.status).toBe(401)
    })
  }

  test('probe rejects an anonymous cloud-mode caller', async () => {
    cloudMode()
    const res = await probePost(
      new Request(`${url}/x/probe`, { method: 'POST' }),
      'x'
    )
    expect(res.status).toBe(401)
  })

  test('401 body uses the shared {error:{message}} shape', async () => {
    cloudMode()
    const res = await handlers.GET(new Request(url))
    const body = (await res.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBe('Authentication required')
  })

  test('an authenticated request gets past the guard', async () => {
    cloudMode()
    const spy = spyOn(apiGuard, 'isAuthenticatedRequest').mockResolvedValue(
      true
    )
    try {
      const res = await handlers.GET(new Request(url))
      expect(spy).toHaveBeenCalled()
      expect(res.status).not.toBe(401)
    } finally {
      spy.mockRestore()
    }
  })

  test('auth none passes the guard', async () => {
    const res = await handlers.GET(new Request(url))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  test('probe with auth none passes the guard', async () => {
    const res = await probePost(
      new Request(`${url}/x/probe`, { method: 'POST' }),
      'x'
    )
    expect(res.status).not.toBe(401)
  })
})
