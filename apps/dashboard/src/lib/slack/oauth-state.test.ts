/**
 * Tests for the stateless OAuth `state` CSRF token (plans/37).
 *
 * Proves a freshly-signed state verifies and returns its bound ownerRef, and
 * that a tampered payload, a wrong secret, and a stale token are all rejected —
 * the CSRF properties the OAuth callback relies on.
 */

import {
  STATE_MAX_AGE_SECONDS,
  signOAuthState,
  verifyOAuthState,
} from './oauth-state'
import { describe, expect, test } from 'bun:test'

const SECRET = 'signing-secret'
const NOW = 1_700_000_000_000

describe('oauth-state', () => {
  test('a freshly-signed state verifies and returns the bound ownerRef', async () => {
    const state = await signOAuthState(SECRET, 'user_abc', NOW)
    const result = await verifyOAuthState(SECRET, state, { nowMs: NOW })
    expect(result).toEqual({ ownerRef: 'user_abc' })
  })

  test('a state signed with a different secret is rejected', async () => {
    const state = await signOAuthState('other-secret', 'user_abc', NOW)
    expect(await verifyOAuthState(SECRET, state, { nowMs: NOW })).toBeNull()
  })

  test('a tampered payload is rejected', async () => {
    const state = await signOAuthState(SECRET, 'user_abc', NOW)
    const [encoded, sig] = state.split('.')
    // Flip a character in the payload, keep the old signature.
    const tampered = `${encoded.slice(0, -1)}${encoded.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`
    expect(await verifyOAuthState(SECRET, tampered, { nowMs: NOW })).toBeNull()
  })

  test('a stale state (beyond the freshness window) is rejected', async () => {
    const state = await signOAuthState(SECRET, 'user_abc', NOW)
    const later = NOW + (STATE_MAX_AGE_SECONDS + 1) * 1000
    expect(await verifyOAuthState(SECRET, state, { nowMs: later })).toBeNull()
  })

  test('missing / malformed state is rejected', async () => {
    expect(await verifyOAuthState(SECRET, null, { nowMs: NOW })).toBeNull()
    expect(await verifyOAuthState(SECRET, '', { nowMs: NOW })).toBeNull()
    expect(await verifyOAuthState(SECRET, 'no-dot', { nowMs: NOW })).toBeNull()
    expect(await verifyOAuthState('', 'x.y', { nowMs: NOW })).toBeNull()
  })
})
