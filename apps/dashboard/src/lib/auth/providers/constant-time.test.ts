/**
 * Truth-table tests for the shared timing-safe comparators (constant-time.ts).
 *
 * `constantTimeEqual` / `secretsMatch` back every shared-secret check in the
 * app (proxy/trusted auth providers, cron routes, Slack + deployment webhook
 * signatures, the agent API bearer token). A silent regression here — e.g.
 * back to a length-leaking `===` — would be invisible without a test.
 */

import { constantTimeEqual, secretsMatch } from './constant-time'
import { describe, expect, test } from 'bun:test'

describe('constantTimeEqual', () => {
  test('returns true for equal buffers', () => {
    expect(
      constantTimeEqual(
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([1, 2, 3, 4])
      )
    ).toBe(true)
  })

  test('returns false when one byte differs', () => {
    expect(
      constantTimeEqual(
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([1, 2, 3, 5])
      )
    ).toBe(false)
  })

  test('returns false on length mismatch', () => {
    expect(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))
    ).toBe(false)
  })

  test('returns true for two empty buffers', () => {
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true)
  })

  test('returns false for empty vs non-empty', () => {
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array([1]))).toBe(false)
  })
})

describe('secretsMatch', () => {
  test('returns true for equal strings', () => {
    expect(secretsMatch('hunter2', 'hunter2')).toBe(true)
  })

  test('returns false when one character differs', () => {
    expect(secretsMatch('hunter2', 'hunter3')).toBe(false)
  })

  test('returns false on length mismatch', () => {
    expect(secretsMatch('short', 'longer-secret')).toBe(false)
  })

  test('returns true for two empty strings', () => {
    expect(secretsMatch('', '')).toBe(true)
  })

  test('returns false for empty vs non-empty', () => {
    expect(secretsMatch('', 'nonempty')).toBe(false)
  })

  test('encodes as UTF-8 before comparing (multi-byte characters)', () => {
    const secret = '密码🔒test'
    expect(secretsMatch(secret, secret)).toBe(true)
    expect(secretsMatch(secret, '密码🔒tesT')).toBe(false)
  })
})
