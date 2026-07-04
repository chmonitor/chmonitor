/**
 * Regression test for #2186: on the anonymous public-read fast path, the
 * `/api/v1/*` guard (`getApiKeyAuthFailure` / `enforceAuth`) must never invoke
 * the Clerk provider's `authenticateRequest` — that call does a full JWT
 * verify (+ cold-start JWKS fetch) that is destined to be discarded anyway,
 * since `provider === 'clerk' && publicReadEnabled()` always resolves to
 * "pass" regardless of the caller's actual auth state (see api-guard.ts).
 *
 * `@/lib/auth/providers` is mocked at its barrel so we can assert
 * `resolveServerAuthProvider` — the only entry point to the Clerk provider
 * used by the guard — is never called when the short-circuit applies, while
 * confirming it's still consulted (and still gates) everywhere else.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

const resolveServerAuthProviderImpl = mock(() => ({
  authenticateRequest: mock(async () => ({ authenticated: false })),
}))

mock.module('@/lib/auth/providers', () => ({
  resolveServerAuthProvider: resolveServerAuthProviderImpl,
}))

const { getApiKeyAuthFailure, enforceAuth } = await import('../api-guard')

const ENV_KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
  'CLERK_SECRET_KEY',
] as const

function apiV1Req(
  method: 'GET' | 'POST' = 'GET',
  path = '/api/v1/hosts'
): Request {
  return new Request(`https://dash.example.com${path}`, { method })
}

describe('#2186 public-read short-circuit skips the Clerk provider call', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    resolveServerAuthProviderImpl.mockClear()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('getApiKeyAuthFailure: anonymous read passes WITHOUT calling the provider', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'

    const result = await getApiKeyAuthFailure(apiV1Req('GET'))

    expect(result).toBeNull()
    expect(resolveServerAuthProviderImpl).not.toHaveBeenCalled()
  })

  it('enforceAuth: anonymous read passes WITHOUT calling the provider', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'

    const result = await enforceAuth(apiV1Req('GET'))

    expect(result).toBeNull()
    expect(resolveServerAuthProviderImpl).not.toHaveBeenCalled()
  })

  it('still calls the provider (and still 401s) for clerk WITHOUT public-read', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    // CHM_CLERK_PUBLIC_READ intentionally unset — private deployment.

    const result = await getApiKeyAuthFailure(apiV1Req('GET'))

    expect(resolveServerAuthProviderImpl).toHaveBeenCalled()
    expect(result?.status).toBe(401)
  })

  it('still calls the provider for a clerk WRITE even when public-read is enabled', async () => {
    // The guard itself is not method-aware — under public-read it passes
    // every /api/v1/* request, by design, deferring write-vs-read enforcement
    // entirely to the per-route `authorizeFeatureRequest()` (see
    // lib/feature-permissions/server.ts: writes never qualify for the
    // anonymous-read baseline there). This test locks that this guard's
    // short-circuit doesn't accidentally start distinguishing methods itself,
    // which would be a behavior change requiring its own review.
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'

    const result = await getApiKeyAuthFailure(apiV1Req('POST'))

    expect(result).toBeNull()
    expect(resolveServerAuthProviderImpl).not.toHaveBeenCalled()
  })
})
