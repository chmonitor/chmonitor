/**
 * #2172 — cloud demo-hiding invariant, enforced server-side.
 *
 * User-connection hosts always use NEGATIVE ids (`DB_CONNECTION_HOST_ID_START
 * = -1000`, browser ids count down from -1); env/demo hosts use `0, 1, 2, …`.
 * So a non-negative hostId from an authenticated cloud principal can only be
 * the hidden demo/env host and must be rejected. OSS and anonymous cloud are
 * unaffected — both legitimately use hostId=0.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

let clerkAuthProvider = true
let signedIn = false

import * as realProvider from '@/lib/auth/provider'

// Spread the real module so unrelated exports (parseAuthProvider, etc.) stay
// intact for other test files sharing this process — only isClerkAuthProvider
// is overridden.
mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => clerkAuthProvider,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

const { isDemoHostBlockedForRequest, isSignedInServer } = await import(
  './reject-demo-host'
)

const CLOUD: Record<string, string | undefined> = { CHM_CLOUD_MODE: 'true' }
const OSS: Record<string, string | undefined> = { CHM_CLOUD_MODE: 'false' }

describe('isSignedInServer', () => {
  beforeEach(() => {
    clerkAuthProvider = true
    signedIn = false
  })

  test('false when Clerk is not the configured auth provider', async () => {
    clerkAuthProvider = false
    signedIn = true
    expect(await isSignedInServer()).toBe(false)
  })

  test('false when Clerk has no session', async () => {
    signedIn = false
    expect(await isSignedInServer()).toBe(false)
  })

  test('true when Clerk has an authenticated session', async () => {
    signedIn = true
    expect(await isSignedInServer()).toBe(true)
  })
})

describe('isDemoHostBlockedForRequest', () => {
  beforeEach(() => {
    clerkAuthProvider = true
    signedIn = false
  })

  test('OSS (cloudMode=false): non-negative hostId is never blocked', async () => {
    signedIn = true
    expect(await isDemoHostBlockedForRequest(0, OSS)).toBe(false)
    expect(await isDemoHostBlockedForRequest(2, OSS)).toBe(false)
  })

  test('anonymous cloud: non-negative hostId is never blocked', async () => {
    signedIn = false
    expect(await isDemoHostBlockedForRequest(0, CLOUD)).toBe(false)
  })

  test('authenticated cloud + hostId=0 (demo): blocked', async () => {
    signedIn = true
    expect(await isDemoHostBlockedForRequest(0, CLOUD)).toBe(true)
  })

  test('authenticated cloud + any non-negative env hostId: blocked', async () => {
    signedIn = true
    expect(await isDemoHostBlockedForRequest(3, CLOUD)).toBe(true)
  })

  test('authenticated cloud + negative hostId (own connection): allowed', async () => {
    signedIn = true
    expect(await isDemoHostBlockedForRequest(-1, CLOUD)).toBe(false)
    expect(await isDemoHostBlockedForRequest(-1000, CLOUD)).toBe(false)
  })
})
