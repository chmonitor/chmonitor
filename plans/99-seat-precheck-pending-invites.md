# Plan 99: Count pending invitations in the org seat pre-check

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/routes/api/v1/org/invite.ts`

## Status

- **Priority**: P3 (route currently latent — not yet called from shipped UI)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (adjacent to the deferred plans/20 seat-cap work — this
  fixes the counting logic those plans will build on)
- **Category**: business-logic
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2516

## Why this matters

`preCheckSeatLimit` counts only **current members** when deciding whether one
more invite fits the plan's seat cap. Outstanding (pending) invitations are
invisible to it, so an org at 2/3 seats can dispatch unlimited invites; excess
members are only bounced post-hoc by the `organizationMembership.created`
webhook rollback — a worse UX (user accepts, then gets kicked) and a
correctness gap independent of when the UI wires this route up. The membership
list call also caps at `limit: 100` without pagination (fine while seat caps
top out at 10, but worth a comment).

## Current state

`apps/dashboard/src/routes/api/v1/org/invite.ts` (~lines 100-120): the doc
comment explains passing the LIVE member count ("no `-1`"), then:

```ts
const memberships = await (await clerkClient()).organizations
  .getOrganizationMembershipList({ organizationId: orgId, limit: 100 })
// ~line 110:
... checkSeatLimit(plan, memberships.data.length)
```

(Read the file for exact call shape.) `checkSeatLimit` lives in
`lib/billing/` (grep it) and is tested. Clerk API for pending invites:
`organizations.getOrganizationInvitationList({ organizationId, status: ['pending'] })`.
The post-hoc rollback lives in `routes/api/webhooks/clerk.ts` — do not change it.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/routes/api/v1/org src/lib/billing` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `invite.ts` `preCheckSeatLimit` (add pending-invite count), its
tests (check for an existing `__tests__` near the route; else co-locate).

**Out of scope**: the webhook rollback; seat-cap UI (plans/20); pagination
beyond a clarifying comment.

## Git workflow

- Branch: `advisor/99-seat-precheck-pending-invites`
- Commit: `fix(org): include pending invitations in seat pre-check`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Add pending invites to the tally
`const pending = await ...getOrganizationInvitationList({ organizationId, status: ['pending'], limit: 100 })`
then `checkSeatLimit(plan, memberships.data.length + pending.data.length)`.
Keep the existing "never throws / null = skip" error posture: wrap in the same
try/catch semantics the function already has.
**Verify**: build green.

### Step 2: Tests
Mock the Clerk client per the route's existing test patterns (see
`webhooks/clerk.ts` tests from PR #2210 for mocking style): members=2 cap=3
pending=0 → allowed; members=2 cap=3 pending=1 → blocked; invitation-list call
throwing → check returns null (skip) not a crash.
**Verify**: `bun test src/routes/api/v1/org` all pass.

## Done criteria

- [ ] Pre-check counts members + pending invites (tested at the boundary)
- [ ] Error posture unchanged (Clerk failure → skip, never throw)
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- The installed Clerk SDK version lacks `getOrganizationInvitationList` —
  report the version and the nearest equivalent API.

## Maintenance notes

- Plans/20 (seat-cap invite-time gate UI) should surface "N pending invites
  count toward your cap" copy using this same tally.
