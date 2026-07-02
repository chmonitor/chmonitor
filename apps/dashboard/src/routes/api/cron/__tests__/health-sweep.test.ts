/**
 * Tests for CRON_SECRET authorization in health-sweep.ts
 *
 * The route's `authorizeCron()` is not exported, so we verify the security
 * contract in two layers:
 *
 *   1. Structural — read the source and assert that:
 *        - `secretsMatch` is imported from the constant-time module
 *        - no bare `===` comparison against the secret remains
 *        - both the Authorization header and `?secret=` query paths use it
 *        - the endpoint fails closed (503) when CRON_SECRET is unset
 *
 *   2. Behavioral — test `secretsMatch` (the comparator used by the route)
 *      directly: correct secret passes, wrong secret is rejected, empty
 *      provided string is rejected.
 *
 * This approach mirrors other route tests in this repo (e.g.,
 * routes/api/v1/browser-connections/__tests__/proxy.test.ts) that use source
 * reading when the relevant function is not exported.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { secretsMatch } from '@/lib/auth/providers/constant-time'

const SOURCE = readFileSync(
  join((import.meta as any).dir, '..', 'health-sweep.ts'),
  'utf-8'
)

// ---------------------------------------------------------------------------
// Structural: verify the constant-time import and usage in the source
// ---------------------------------------------------------------------------

describe('health-sweep.ts CRON_SECRET authorization (structural)', () => {
  test('imports secretsMatch from the constant-time module', () => {
    expect(SOURCE).toContain(
      "import { secretsMatch } from '@/lib/auth/providers/constant-time'"
    )
  })

  test('uses secretsMatch for Authorization header comparison', () => {
    expect(SOURCE).toMatch(
      /secretsMatch\(authHeader,\s*`Bearer \$\{secret\}`\)/
    )
  })

  test('uses secretsMatch for ?secret= query param comparison', () => {
    expect(SOURCE).toMatch(/secretsMatch\(querySecret,\s*secret\)/)
  })

  test('does NOT use === to compare secrets (timing-safe check)', () => {
    // The two replaced comparisons should be gone; only `=== 0` (inside
    // constantTimeEqual) or `=== secret` outside isAuthorized must not appear.
    // We look specifically for === with the secret variable — if either old
    // branch remained the route would leak timing information.
    expect(SOURCE).not.toMatch(/authHeader === `Bearer/)
    expect(SOURCE).not.toMatch(/searchParams\.get\(['"]secret['"]\) ===/)
  })

  test('fails closed when CRON_SECRET is unset (503, not open)', () => {
    // Security (issue #2135): when CRON_SECRET is not configured the endpoint
    // must DENY the request, not allow it. The old insecure guard
    // (`if (!secret) return true`) must be gone.
    expect(SOURCE).not.toMatch(/if\s*\(!secret\)\s*return true/)
    // The unset branch returns a 503 with a JSON error body.
    expect(SOURCE).toMatch(/if\s*\(!secret\)/)
    expect(SOURCE).toContain("error: 'CRON_SECRET not configured'")
    expect(SOURCE).toMatch(/status:\s*503/)
  })
})

// ---------------------------------------------------------------------------
// Behavioral: secretsMatch — the comparator the route delegates to
// ---------------------------------------------------------------------------

describe('secretsMatch (behavioral, from constant-time module)', () => {
  test('returns true when provided and expected are identical', () => {
    expect(secretsMatch('mysecret', 'mysecret')).toBe(true)
  })

  test('returns true for Authorization header format used by the route', () => {
    const secret = 'my-cron-secret'
    const header = `Bearer ${secret}`
    expect(secretsMatch(header, `Bearer ${secret}`)).toBe(true)
  })

  test('returns false when provided differs from expected (wrong secret)', () => {
    expect(secretsMatch('wrongsecret', 'correctsecret')).toBe(false)
  })

  test('returns false when provided is empty string (no secret supplied)', () => {
    expect(secretsMatch('', 'correctsecret')).toBe(false)
  })

  test('returns false when secrets differ by one character', () => {
    expect(secretsMatch('mysecretX', 'mysecretY')).toBe(false)
  })

  test('returns false on length mismatch (shorter provided)', () => {
    expect(secretsMatch('short', 'longsecret')).toBe(false)
  })

  test('returns false on length mismatch (longer provided)', () => {
    expect(secretsMatch('longsecret', 'short')).toBe(false)
  })
})
