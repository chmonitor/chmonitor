import { checkSeatLimit } from './entitlements'
import { BILLING_PLAN_LIST } from './plans'
import { describe, expect, test } from 'bun:test'

// All current plans publish seats:null (unlimited). These assertions document
// GA-pending behaviour — remove the short-circuit in owner-usage.ts when a
// plan reintroduces seat caps.
describe('seat-enforcement — no user/seat cap (GA-pending)', () => {
  test('invite and membership never block on seats', () => {
    for (const plan of BILLING_PLAN_LIST) {
      expect(checkSeatLimit(plan, 0).allowed).toBe(true)
      expect(checkSeatLimit(plan, 10_000).allowed).toBe(true)
      expect(checkSeatLimit(plan, 10_000).unlimited).toBe(true)
    }
  })
})
