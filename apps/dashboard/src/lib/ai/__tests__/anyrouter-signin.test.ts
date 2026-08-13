/**
 * Tests for the "Sign in with AnyRouter" core logic: PKCE derivation, cookie
 * serialize/parse round trip, redirect-URI derivation (HTTPS-only + localhost
 * dev allowance), client-registration caching, and token exchange
 * success/failure shapes. `fetch` is mocked — no real network calls.
 */

import {
  __resetClientIdCacheForTests,
  ANYROUTER_CALLBACK_PATH,
  ANYROUTER_REGISTER_URL,
  ANYROUTER_SIGNIN_COOKIE_NAME,
  ANYROUTER_TOKEN_URL,
  AnyRouterSigninError,
  buildAuthorizeUrl,
  buildSigninResultHtml,
  clearSigninCookieHeader,
  deriveCodeChallenge,
  deriveOriginUrl,
  deriveRedirectUri,
  exchangeCodeForToken,
  generateCodeVerifier,
  generateState,
  getOrRegisterClientId,
  parseSigninCookie,
  serializeSigninCookie,
} from '../anyrouter-signin'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

describe('PKCE derivation', () => {
  test('known verifier maps to known S256 challenge (RFC 7636 appendix B)', async () => {
    // RFC 7636 appendix B test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = await deriveCodeChallenge(verifier)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('generateCodeVerifier produces a base64url string with no padding', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier.length).toBeGreaterThan(20)
  })

  test('generateState produces distinct values', () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('redirect URI / origin derivation', () => {
  test('derives https redirect URI from request origin', () => {
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    expect(deriveRedirectUri(request)).toBe(
      `https://dash.chmonitor.dev${ANYROUTER_CALLBACK_PATH}`
    )
  })

  test('allows http on localhost for dev', () => {
    const request = new Request(
      'http://localhost:3000/api/v1/agents/anyrouter/login'
    )
    expect(deriveRedirectUri(request)).toBe(
      `http://localhost:3000${ANYROUTER_CALLBACK_PATH}`
    )
  })

  test('allows http on 127.0.0.1 for dev', () => {
    const request = new Request(
      'http://127.0.0.1:3000/api/v1/agents/anyrouter/login'
    )
    expect(deriveRedirectUri(request)).toBe(
      `http://127.0.0.1:3000${ANYROUTER_CALLBACK_PATH}`
    )
  })

  test('rejects http on a non-localhost origin', () => {
    const request = new Request(
      'http://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    expect(() => deriveRedirectUri(request)).toThrow(AnyRouterSigninError)
  })

  test('deriveOriginUrl returns scheme://host', () => {
    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    expect(deriveOriginUrl(request)).toBe('https://dash.chmonitor.dev')
  })
})

describe('signin cookie serialize/parse round trip', () => {
  test('round-trips a payload', () => {
    const header = serializeSigninCookie(
      { v: 'verifier-1', s: 'state-1' },
      { secure: true }
    )
    // Simulate the browser only sending back name=value in the Cookie header.
    const cookieHeader = header.split(';')[0]
    const parsed = parseSigninCookie(cookieHeader)
    expect(parsed).toEqual({ v: 'verifier-1', s: 'state-1' })
  })

  test('serialized cookie carries HttpOnly, SameSite=Lax and the configured Secure flag', () => {
    const secureHeader = serializeSigninCookie(
      { v: 'v', s: 's' },
      { secure: true }
    )
    expect(secureHeader).toContain('HttpOnly')
    expect(secureHeader).toContain('SameSite=Lax')
    expect(secureHeader).toContain('Secure')

    const insecureHeader = serializeSigninCookie(
      { v: 'v', s: 's' },
      { secure: false }
    )
    expect(insecureHeader).not.toContain('Secure')
  })

  test('parseSigninCookie returns null for missing/malformed cookie header', () => {
    expect(parseSigninCookie(null)).toBeNull()
    expect(parseSigninCookie('')).toBeNull()
    expect(parseSigninCookie('other_cookie=value')).toBeNull()
    expect(
      parseSigninCookie(`${ANYROUTER_SIGNIN_COOKIE_NAME}=not-json`)
    ).toBeNull()
    expect(
      parseSigninCookie(
        `${ANYROUTER_SIGNIN_COOKIE_NAME}=${encodeURIComponent('{"v":1}')}`
      )
    ).toBeNull()
  })

  test('clearSigninCookieHeader expires the cookie', () => {
    const header = clearSigninCookieHeader({ secure: true })
    expect(header).toContain(`${ANYROUTER_SIGNIN_COOKIE_NAME}=;`)
    expect(header).toContain('Max-Age=0')
  })
})

describe('client registration caching', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    __resetClientIdCacheForTests()
  })

  afterEach(() => {
    global.fetch = originalFetch
    __resetClientIdCacheForTests()
  })

  test('registers a client and caches the client_id per origin', async () => {
    let callCount = 0
    global.fetch = mock(async (input: RequestInfo | URL) => {
      callCount++
      expect(String(input)).toBe(ANYROUTER_REGISTER_URL)
      return new Response(JSON.stringify({ client_id: 'client-abc' }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const first = await getOrRegisterClientId(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback',
      'https://dash.chmonitor.dev'
    )
    const second = await getOrRegisterClientId(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback',
      'https://dash.chmonitor.dev'
    )

    expect(first).toBe('client-abc')
    expect(second).toBe('client-abc')
    expect(callCount).toBe(1)
  })

  test('ANYROUTER_OAUTH_CLIENT_ID env override skips registration entirely', async () => {
    global.fetch = mock(async () => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch

    const clientId = await getOrRegisterClientId(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback',
      'https://dash.chmonitor.dev',
      { ANYROUTER_OAUTH_CLIENT_ID: 'pinned-client' }
    )
    expect(clientId).toBe('pinned-client')
  })

  test('throws AnyRouterSigninError on a non-ok registration response', async () => {
    global.fetch = mock(
      async () => new Response('nope', { status: 500 })
    ) as unknown as typeof fetch

    await expect(
      getOrRegisterClientId(
        'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback',
        'https://dash.chmonitor.dev'
      )
    ).rejects.toThrow(AnyRouterSigninError)
  })

  test('buildAuthorizeUrl assembles all required query params', async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ client_id: 'client-xyz' }), {
          status: 200,
        })
    ) as unknown as typeof fetch

    const request = new Request(
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/login'
    )
    const result = await buildAuthorizeUrl(request)

    const url = new URL(result.authorizeUrl)
    expect(url.searchParams.get('client_id')).toBe('client-xyz')
    expect(url.searchParams.get('redirect_uri')).toBe(
      `https://dash.chmonitor.dev${ANYROUTER_CALLBACK_PATH}`
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(result.state)
    expect(typeof result.codeVerifier).toBe('string')
    expect(result.codeVerifier.length).toBeGreaterThan(20)
  })
})

describe('token exchange', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('returns the access token on success', async () => {
    global.fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(ANYROUTER_TOKEN_URL)
      return new Response(
        JSON.stringify({
          access_token: 'sk-ar-v1-secret',
          token_type: 'Bearer',
          scope: 'inference read:profile',
          expires_in: 2592000,
        }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const result = await exchangeCodeForToken(
      'auth-code',
      'verifier',
      'https://dash.chmonitor.dev/api/v1/agents/anyrouter/callback',
      'client-abc'
    )

    expect(result.accessToken).toBe('sk-ar-v1-secret')
    expect(result.tokenType).toBe('Bearer')
    expect(result.scope).toBe('inference read:profile')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  test('throws AnyRouterSigninError on a non-ok response, without leaking the body', async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ secret: 'sk-ar-should-not-leak' }), {
          status: 400,
        })
    ) as unknown as typeof fetch

    let caught: unknown
    try {
      await exchangeCodeForToken(
        'bad-code',
        'verifier',
        'https://x/cb',
        'client-abc'
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AnyRouterSigninError)
    expect((caught as Error).message).not.toContain('sk-ar-should-not-leak')
  })

  test('throws AnyRouterSigninError when access_token is missing', async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 })
    ) as unknown as typeof fetch

    await expect(
      exchangeCodeForToken('code', 'verifier', 'https://x/cb', 'client-abc')
    ).rejects.toThrow(AnyRouterSigninError)
  })

  test('throws AnyRouterSigninError when fetch itself fails', async () => {
    global.fetch = mock(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    await expect(
      exchangeCodeForToken('code', 'verifier', 'https://x/cb', 'client-abc')
    ).rejects.toThrow(AnyRouterSigninError)
  })
})

describe('buildSigninResultHtml', () => {
  test('success payload embeds the token for the one-time postMessage', () => {
    const html = buildSigninResultHtml(
      { ok: true, token: 'sk-ar-v1-secret', expiresAt: 12345 },
      'https://dash.chmonitor.dev'
    )
    expect(html).toContain('sk-ar-v1-secret')
    expect(html).toContain('window.opener.postMessage')
    expect(html).toContain('window.close()')
    expect(html).toContain(JSON.stringify('https://dash.chmonitor.dev'))
  })

  test('failure payload carries the error message, no token field', () => {
    const html = buildSigninResultHtml(
      { ok: false, error: 'boom' },
      'https://dash.chmonitor.dev'
    )
    expect(html).toContain('"ok":false')
    expect(html).toContain('boom')
    expect(html).not.toContain('"token"')
  })
})
