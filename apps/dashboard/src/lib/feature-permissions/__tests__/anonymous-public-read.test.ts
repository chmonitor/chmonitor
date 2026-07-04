/**
 * Tests for `isAnonymousPublicReadRequest` — the strict isSignedIn/public-read
 * split used to gate the shared edge cache (#2181). It must reuse the exact
 * same auth resolution as `authorizeFeatureRequest` so the two can never
 * disagree about who counts as "signed in".
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// readEnv() in server.ts prefers the cloudflare:workers `env` binding, then
// falls back to process.env. Mock the binding empty so the tests drive config
// purely through process.env (mirrors app-config-cache.test.ts).
mock.module('cloudflare:workers', () => ({ env: {} }))

let clerkAuthResult: { userId?: string } | null = null
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => clerkAuthResult,
}))

const ENV_KEYS = ['CHM_AUTH_PROVIDER', 'CHM_CLERK_PUBLIC_READ']

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

describe('isAnonymousPublicReadRequest', () => {
  beforeEach(async () => {
    clearEnv()
    const { _resetAppConfigCache } = await import('../server')
    _resetAppConfigCache()
    clerkAuthResult = null
  })

  afterEach(async () => {
    clearEnv()
    const { _resetAppConfigCache } = await import('../server')
    _resetAppConfigCache()
  })

  test('false when publicReadEnabled() is off, regardless of auth', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'false'
    const { isAnonymousPublicReadRequest } = await import('../server')
    const request = new Request('https://dash.example.com/api/v1/charts/foo')
    expect(await isAnonymousPublicReadRequest(request)).toBe(false)
  })

  test('true for an anonymous clerk request under public-read', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    clerkAuthResult = null // no session
    const { isAnonymousPublicReadRequest } = await import('../server')
    const request = new Request('https://dash.example.com/api/v1/charts/foo')
    expect(await isAnonymousPublicReadRequest(request)).toBe(true)
  })

  test('false for a SIGNED-IN clerk request even under public-read (the leak this gate exists to prevent)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    clerkAuthResult = { userId: 'user_123' } // isSignedIn: true
    const { isAnonymousPublicReadRequest } = await import('../server')
    const request = new Request('https://dash.example.com/api/v1/charts/foo')
    expect(await isAnonymousPublicReadRequest(request)).toBe(false)
  })

  test('false when auth provider is `none`, even if CHM_CLERK_PUBLIC_READ is set (no anonymous/signed-in split to protect)', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.CHM_CLERK_PUBLIC_READ = 'true'
    const { isAnonymousPublicReadRequest } = await import('../server')
    const request = new Request('https://dash.example.com/api/v1/charts/foo')
    expect(await isAnonymousPublicReadRequest(request)).toBe(false)
  })
})
