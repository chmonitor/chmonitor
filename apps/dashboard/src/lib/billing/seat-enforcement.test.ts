import { checkSeatLimit } from './entitlements'
import { BILLING_PLAN_LIST } from './plans'
import { describe, expect, test } from 'bun:test'

describe('seat-enforcement — no user/seat cap', () => {
  test('invite and membership never block on seats', () => {
    for (const plan of BILLING_PLAN_LIST) {
      expect(checkSeatLimit(plan, 0).allowed).toBe(true)
      expect(checkSeatLimit(plan, 10_000).allowed).toBe(true)
      expect(checkSeatLimit(plan, 10_000).unlimited).toBe(true)
    }
  })
})
