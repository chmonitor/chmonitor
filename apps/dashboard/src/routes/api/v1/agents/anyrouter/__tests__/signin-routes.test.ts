/**
 * Tests for GET /api/v1/agents/anyrouter/login and .../callback — the
 * "Sign in with AnyRouter" popup flow's HTTP surface. `authorizeAgentApiRequest`
 * and the core `lib/ai/anyrouter-signin` collaborators are mocked so this
 * stays a pure unit test of routing/cookie/state wiring (the core PKCE/token
 * logic itself is covered by `lib/ai/__tests__/anyrouter-signin.test.ts`).
 *
 * Mirrors the `mock.module` + `__handleGetForTests` conventions used across
 * `routes/api/v1/**` (see `user-connections.test.ts`, `audit/export.test.ts`).
 * `cloudflare:workers` is stubbed because both routes import `env` from it at
 * module scope.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let authGateResponse: Response | null = null
const authorizeAgentApiRequest = mock(async () => authGateResponse)
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: () => authorizeAgentApiRequest(),
}))

const { __handleGetForTests: handleLoginGet } = await import('../login')
const { __handleGetForTests: handleCallbackGet } = await import('../callback')

describe('GET /api/v1/agents/anyrouter/login', () => {
  beforeEach(() => {
    authGateResponse = null
    authorizeAgentApiRequest.mockClear()
  })

  test('returns the auth gate response unchanged when denied', async () => {
    authGateResponse = Response.json({ error: 'forbidden' }, { status: 403 })
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )

    const response = await handleLoginGet(request)

    expect(response.status).toBe(403)
    expect(authorizeAgentApiRequest).toHaveBeenCalled()
  })

  test('returns authorizeUrl + state and sets an httpOnly Secure cookie on success', async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ client_id: 'client-abc' }), {
          status: 200,
        })
    ) as unknown as typeof fetch

    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    const response = await handleLoginGet(request)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      authorizeUrl: string
      state: string
    }
    expect(body.authorizeUrl).toContain(
      'https://anyrouter.dev/api/v1/mcp/oauth/authorize'
    )
    expect(body.authorizeUrl).toContain(`state=${body.state}`)

    const cookie = response.headers.get('Set-Cookie')
    expect(cookie).toBeTruthy()
    expect(cookie).toContain('chm_anyrouter_pkce=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    // The code_verifier must never be exposed in the JSON body.
    expect(JSON.stringify(body)).not.toContain('code_verifier')
  })

  test('does not set Secure on an http (localhost dev) request', async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ client_id: 'client-abc' }), {
          status: 200,
        })
    ) as unknown as typeof fetch

    const request = new Request(
      'http://localhost:3000/api/v1/agents/anyrouter/login'
    )
    const response = await handleLoginGet(request)

    const cookie = response.headers.get('Set-Cookie')
    expect(cookie).not.toContain('Secure')
  })

  test('fails closed with a clean JSON error when registration fails', async () => {
    global.fetch = mock(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch

    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    const response = await handleLoginGet(request)

    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBeTruthy()
    expect(body.error).not.toContain('undefined')
  })
})

describe('GET /api/v1/agents/anyrouter/callback', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    global.fetch = undefined
  })

  function cookieHeaderFor(state: string, verifier = 'verifier-123'): string {
    return `chm_anyrouter_pkce=${encodeURIComponent(JSON.stringify({ v: verifier, s: state }))}`
  }

  test('rejects when the cookie is missing (expired/no session)', async () => {
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback?code=abc&state=xyz'
    )
    const response = await handleCallbackGet(request)

    expect(response.status).toBe(200) // popup page, not an HTTP error
    const html = await response.text()
    expect(html).toContain('"ok":false')
    expect(html).toContain('expired')
  })

  test('rejects on state mismatch', async () => {
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback?code=abc&state=wrong-state',
      { headers: { Cookie: cookieHeaderFor('correct-state') } }
    )
    const response = await handleCallbackGet(request)

    const html = await response.text()
    expect(html).toContain('"ok":false')
    expect(html).toContain('state mismatch')
  })

  test('propagates an upstream OAuth error param', async () => {
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback?error=access_denied&state=s',
      { headers: { Cookie: cookieHeaderFor('s') } }
    )
    const response = await handleCallbackGet(request)

    const html = await response.text()
    expect(html).toContain('"ok":false')
    expect(html).toContain('access_denied')
  })

  test('exchanges the code and posts the token on success, clearing the cookie', async () => {
    global.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/register')) {
        return new Response(JSON.stringify({ client_id: 'client-abc' }), {
          status: 200,
        })
      }
      if (url.includes('/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'sk-ar-v1-secret',
            token_type: 'Bearer',
            scope: 'inference read:profile',
            expires_in: 2592000,
          }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback?code=good-code&state=match',
      { headers: { Cookie: cookieHeaderFor('match') } }
    )
    const response = await handleCallbackGet(request)

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('"ok":true')
    expect(html).toContain('sk-ar-v1-secret')
    expect(html).toContain('window.opener.postMessage')

    const cookie = response.headers.get('Set-Cookie')
    expect(cookie).toContain('Max-Age=0')
  })

  test('fails closed with a clean error page when the token exchange fails', async () => {
    global.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/register')) {
        return new Response(JSON.stringify({ client_id: 'client-abc' }), {
          status: 200,
        })
      }
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ secret: 'must-not-leak' }), {
          status: 400,
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback?code=bad-code&state=match',
      { headers: { Cookie: cookieHeaderFor('match') } }
    )
    const response = await handleCallbackGet(request)

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('"ok":false')
    expect(html).not.toContain('must-not-leak')
  })
})
