import { parseLimit } from '../parse-limit'
import { describe, expect, test } from 'bun:test'

describe('parseLimit', () => {
  test('absent or empty yields the default', () => {
    expect(parseLimit(null, { max: 1000, default: 200 })).toEqual({
      ok: true,
      value: 200,
    })
    expect(parseLimit('', { max: 1000 })).toEqual({
      ok: true,
      value: undefined,
    })
  })

  test.each(['abc', '0', '-1', '1.5', 'NaN'])('rejects %s', (raw) => {
    expect(parseLimit(raw, { max: 1000 }).ok).toBe(false)
  })

  test('passes a valid value and clamps above max', () => {
    expect(parseLimit('50', { max: 1000 })).toEqual({ ok: true, value: 50 })
    expect(parseLimit('5000', { max: 1000 })).toEqual({
      ok: true,
      value: 1000,
    })
  })
})
