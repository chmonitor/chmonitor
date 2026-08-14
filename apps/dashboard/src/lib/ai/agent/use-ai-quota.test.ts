import { parseQuota } from './use-ai-quota'
import { describe, expect, test } from 'bun:test'

describe('parseQuota', () => {
  test('reads data.aiMessages used/limit (signed-in + guest usage payload)', () => {
    const quota = parseQuota({
      success: true,
      data: {
        planId: 'guest',
        planName: 'Guest',
        aiMessages: { used: 2, limit: 3, unlimited: false },
      },
    })
    expect(quota).toEqual({
      used: 2,
      limit: 3,
      remaining: 1,
      unlimited: false,
    })
  })

  test('reads top-level aiMessages', () => {
    const quota = parseQuota({
      aiMessages: { used: 0, limit: 3, unlimited: false },
    })
    expect(quota.used).toBe(0)
    expect(quota.limit).toBe(3)
    expect(quota.remaining).toBe(3)
    expect(quota.unlimited).toBe(false)
  })

  test('still reads data.ai / data.aiDaily', () => {
    expect(
      parseQuota({ data: { ai: { used: 1, limit: 5, unlimited: false } } })
    ).toMatchObject({ used: 1, limit: 5, remaining: 4 })
    expect(
      parseQuota({
        data: { aiDaily: { used: 4, limit: 5, unlimited: false } },
      })
    ).toMatchObject({ used: 4, limit: 5, remaining: 1 })
  })

  test('malformed / missing meter hides the chip', () => {
    expect(parseQuota(null).unlimited).toBe(true)
    expect(
      parseQuota({ success: true, data: { planId: 'free' } }).unlimited
    ).toBe(true)
  })
})
