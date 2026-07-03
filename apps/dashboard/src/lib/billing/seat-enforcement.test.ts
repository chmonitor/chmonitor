/**
 * Seat-enforcement unit tests.
 *
 * Two admission points share `checkSeatLimit` but pass a DIFFERENT count,
 * because they observe the roster at different times:
 *
 * - **Invite-time pre-check** (plan 20, `routes/api/v1/org/invite.ts`
 *   `preCheckSeatLimit`, mirrored below as `preCheckAdmit`) runs BEFORE the
 *   invite is created — the member does not exist yet, so it passes the LIVE
 *   count straight through (no `-1`).
 * - **Webhook rollback** (`routes/api/v1/webhooks/clerk.ts`, `admit` below)
 *   fires AFTER Clerk has already added the member, so `memberships.data.length`
 *   (`count`) already includes them (post-addition total) — the handler passes
 *   the pre-addition count (`count - 1`) to ask the same "room for one more?"
 *   question against the pre-addition roster.
 *
 * Both call `checkSeatLimit`, which uses `used < limit` ("is there room for
 * one more?"). The functions below mirror each call site's exact arithmetic so
 * these tests model real behaviour, not a reimplementation that could drift.
 */

import type { Plan } from './plans'

import { checkSeatLimit } from './entitlements'
import { BILLING_PLANS } from './plans'
import { describe, expect, test } from 'bun:test'

const { free, pro, enterprise } = BILLING_PLANS

// Mirrors the webhook: `count` is the post-addition membership total; admission
// asks whether the pre-addition roster had room for one more.
const admit = (plan: Plan, count: number) => checkSeatLimit(plan, count - 1)

// Mirrors the invite-time pre-check (routes/api/v1/org/invite.ts
// preCheckSeatLimit): `currentMembers` is the LIVE, pre-invite count — no `-1`.
const preCheckAdmit = (plan: Plan, currentMembers: number) =>
  checkSeatLimit(plan, currentMembers)

describe('seat-enforcement — webhook admission (post-addition count)', () => {
  test('Free (seats=1): count=1 → allowed (first member fits)', () => {
    expect(admit(free, 1).allowed).toBe(true)
  })

  test('Free (seats=1): count=2 → denied (over the cap — rollback new member)', () => {
    const check = admit(free, 2)
    expect(check.allowed).toBe(false)
    expect(check.limit).toBe(1)
    expect(check.remaining).toBe(0)
    expect(check.reason).toBe('seat_limit')
  })

  test('Pro (seats=3): count=3 → allowed (fills the last seat)', () => {
    expect(admit(pro, 3).allowed).toBe(true)
  })

  test('Pro (seats=3): count=4 → denied (over the cap — rollback new member)', () => {
    expect(admit(pro, 4).allowed).toBe(false)
  })

  test('Enterprise (seats=null): any count → always allowed (unlimited)', () => {
    const check = admit(enterprise, 1_000)
    expect(check.allowed).toBe(true)
    expect(check.unlimited).toBe(true)
    expect(check.limit).toBeNull()
    expect(check.remaining).toBeNull()
  })
})

describe('seat-enforcement — invite-time pre-check (live, pre-addition count)', () => {
  test('Free (seats=1): currentMembers=0 → allowed (room for the first invite)', () => {
    expect(preCheckAdmit(free, 0).allowed).toBe(true)
  })

  test('Free (seats=1): currentMembers=1 (at cap) → denied — 402 before any invite is created', () => {
    const check = preCheckAdmit(free, 1)
    expect(check.allowed).toBe(false)
    expect(check.limit).toBe(1)
    expect(check.remaining).toBe(0)
    expect(check.reason).toBe('seat_limit')
  })

  test('Pro (seats=3): currentMembers=2 (seats-1) → allowed — invite proceeds', () => {
    expect(preCheckAdmit(pro, 2).allowed).toBe(true)
  })

  test('Pro (seats=3): currentMembers=3 (at cap) → denied — 402 before any invite is created', () => {
    const check = preCheckAdmit(pro, 3)
    expect(check.allowed).toBe(false)
  })

  test('Enterprise (seats=null): any currentMembers → always allowed (unlimited)', () => {
    const check = preCheckAdmit(enterprise, 1_000)
    expect(check.allowed).toBe(true)
    expect(check.unlimited).toBe(true)
  })
})
