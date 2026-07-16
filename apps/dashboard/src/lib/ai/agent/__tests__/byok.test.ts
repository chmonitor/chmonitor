import { describe, expect, test } from 'bun:test'

import {
  BYOK_MAX_KEY_LENGTH,
  BYOK_MIN_KEY_LENGTH,
  parseByokApiKey,
} from '../byok'

describe('parseByokApiKey', () => {
  test('accepts a typical provider key and trims surrounding whitespace', () => {
    expect(parseByokApiKey('  sk-abc123DEF456  ')).toBe('sk-abc123DEF456')
  })

  test('allows punctuation common in real keys (- and _)', () => {
    expect(parseByokApiKey('sk-or-v1_ABCdef-789')).toBe('sk-or-v1_ABCdef-789')
  })

  test('rejects non-string input', () => {
    expect(parseByokApiKey(undefined)).toBeNull()
    expect(parseByokApiKey(null)).toBeNull()
    expect(parseByokApiKey(12345678)).toBeNull()
    expect(parseByokApiKey({ key: 'sk-abc' })).toBeNull()
  })

  test('rejects empty / too-short keys', () => {
    expect(parseByokApiKey('')).toBeNull()
    expect(parseByokApiKey('   ')).toBeNull()
    expect(parseByokApiKey('a'.repeat(BYOK_MIN_KEY_LENGTH - 1))).toBeNull()
  })

  test('accepts a key at the minimum length', () => {
    const key = 'a'.repeat(BYOK_MIN_KEY_LENGTH)
    expect(parseByokApiKey(key)).toBe(key)
  })

  test('rejects keys over the maximum length', () => {
    expect(parseByokApiKey('a'.repeat(BYOK_MAX_KEY_LENGTH + 1))).toBeNull()
  })

  test('rejects keys containing internal whitespace', () => {
    expect(parseByokApiKey('sk-abc def')).toBeNull()
    expect(parseByokApiKey(`sk-abc${String.fromCharCode(9)}def`)).toBeNull()
    expect(parseByokApiKey(`sk-abc${String.fromCharCode(10)}def`)).toBeNull()
  })

  test('rejects keys containing control characters', () => {
    // NUL (0x00), unit-separator (0x1f), DEL (0x7f) embedded in the key.
    expect(parseByokApiKey(`sk-abc${String.fromCharCode(0)}def`)).toBeNull()
    expect(parseByokApiKey(`sk-abc${String.fromCharCode(0x1f)}def`)).toBeNull()
    expect(parseByokApiKey(`sk-abc${String.fromCharCode(0x7f)}def`)).toBeNull()
  })
})
