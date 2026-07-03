/**
 * Real-crypto tests for the GitHub webhook signature gate — the inbound-auth
 * invariant of plans/45-github-deploy-correlation.md: chmonitor never trusts a
 * deployment payload it can't verify. No mocks here (unlike Polar/Clerk, which
 * delegate to an SDK's own verify function) — this computes real HMAC-SHA256
 * signatures so the accept/reject paths are proven against the actual crypto,
 * not a stand-in.
 */

import {
  computeGithubSignature,
  verifyGithubSignature,
} from './verify-signature'
import { describe, expect, test } from 'bun:test'

const SECRET = 'test-webhook-secret'
const BODY = JSON.stringify({
  deployment: { id: 42 },
  repository: { full_name: 'a/b' },
})

describe('verifyGithubSignature', () => {
  test('a correctly-signed body is accepted', async () => {
    const signature = await computeGithubSignature(SECRET, BODY)
    expect(await verifyGithubSignature(SECRET, BODY, signature)).toBe(true)
  })

  test('a tampered body is rejected', async () => {
    const signature = await computeGithubSignature(SECRET, BODY)
    const tamperedBody = JSON.stringify({
      deployment: { id: 42 },
      repository: { full_name: 'attacker/repo' },
    })

    expect(await verifyGithubSignature(SECRET, tamperedBody, signature)).toBe(
      false
    )
  })

  test('a signature computed with the wrong secret is rejected', async () => {
    const signature = await computeGithubSignature('a-different-secret', BODY)
    expect(await verifyGithubSignature(SECRET, BODY, signature)).toBe(false)
  })

  test('a missing signature header is rejected', async () => {
    expect(await verifyGithubSignature(SECRET, BODY, null)).toBe(false)
    expect(await verifyGithubSignature(SECRET, BODY, undefined)).toBe(false)
    expect(await verifyGithubSignature(SECRET, BODY, '')).toBe(false)
  })

  test('a signature header missing the sha256= prefix is rejected', async () => {
    const signature = await computeGithubSignature(SECRET, BODY)
    const rawHex = signature.replace('sha256=', '')
    expect(await verifyGithubSignature(SECRET, BODY, rawHex)).toBe(false)
  })
})
