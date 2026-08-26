import { constantTimeEqual, timingSafeEqualString } from '../timing'
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
})

describe('timingSafeEqualString', () => {
  test('returns true for equal strings', () => {
    expect(timingSafeEqualString('hunter2', 'hunter2')).toBe(true)
  })

  test('returns false when one character differs', () => {
    expect(timingSafeEqualString('hunter2', 'hunter3')).toBe(false)
  })

  test('returns false on length mismatch', () => {
    expect(timingSafeEqualString('short', 'longer-secret')).toBe(false)
  })

  test('returns true for two empty strings', () => {
    expect(timingSafeEqualString('', '')).toBe(true)
  })

  test('encodes as UTF-8 before comparing (multi-byte characters)', () => {
    const secret = '密码🔒test'
    expect(timingSafeEqualString(secret, secret)).toBe(true)
    expect(timingSafeEqualString(secret, '密码🔒tesT')).toBe(false)
  })
})
