# 20 — Seat-cap invite-time gate

## Kickoff prompt

```text
Execute plans/20-seat-cap-invite-time-gate.md ALONE (do not touch other plans).
Goal: enforce the seat cap PRE-EMPTIVELY at invite time (402 + paywall before the
member is added) instead of only post-hoc via the Clerk webhook rollback. Keep the
webhook rollback as defense-in-depth.
Invariants you must not violate:
  - Self-hosted/OSS stays whole: seat resolution FAILS OPEN without Clerk — no Clerk
    org context → no gate, invite proceeds. Verify this path.
  - Honest paywalls: advertised ⟺ enforced (or `deferred`) in lib/billing/plan-enforcement.ts.
    seats must be `enforced` after this (it becomes a real pre-check); update the gate string.
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2.
The 402 you return must carry reason:'seat' so the plan-15 PaywallModal can render it.
End by running the Verification block and pasting results.
```

## Current reality (audited)

The seat limit is enforced **post-hoc**: Clerk adds the member, then the `organizationMembership.created` webhook counts members and rolls the over-limit member back — confusing UX (a user is added, then removed).

- Post-hoc path: `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts` handles `organizationMembership.created` (`clerk.ts:47`), resolves the owner's plan, and calls `checkSeatLimit(plan, count - 1)` (`clerk.ts:72`) — note the `count - 1` because the webhook fires *after* Clerk has already added the member (`clerk.ts:68–70` comment). Over-limit members are rolled back.
- Seat helper: `apps/dashboard/src/lib/billing/entitlements.ts:86` `checkSeatLimit(plan, currentSeats)` — semantics: `used < limit` ("room for one more?").
- Plan resolution: `getPlanForOwner` lives in `apps/dashboard/src/lib/billing/user-subscription.ts` (also imported by `retention-owner.ts`, `plan-capability.ts`) — **not** in `entitlements.ts` (spec pointer refined). `(verify import path)`.
- **The invite endpoint is not yet its own route.** A repo scan found invitation logic only referenced from `webhooks/clerk.ts`; there is no dedicated `routes/api/v1/**/invite*.ts`. Invites are likely issued client-side via Clerk's `<OrganizationProfile>` / `useOrganization().inviteMember`, or via a thin server proxy that must be located. **First task: locate where an invite is issued** (grep `createOrganizationInvitation`, `inviteMember`, `invitations`), because the pre-check must live at that call.
- Seat-enforcement tests already exist: `apps/dashboard/src/lib/billing/seat-enforcement.test.ts` — extend, don't duplicate.

## Goal

Seat limit is checked **before** the invite is created: at seats-full, the invite is rejected with a 402 (`reason: 'seat'`) that drives the paywall, so no member is ever added-then-removed. The Clerk webhook rollback stays as a belt-and-suspenders fallback.

## Implement now

### A. Locate / create the invite server path
- Grep for the invite issuance: `createOrganizationInvitation`, `inviteMember`, `organization.inviteMember`, `/invitations`.
- **If a server route exists** (e.g. a proxy that calls Clerk's Backend API `createOrganizationInvitation`): add the pre-check there.
- **If invites are purely client-side** (Clerk components/`useOrganization`): add a thin server route `apps/dashboard/src/routes/api/v1/org/invite.ts` (`POST { emailAddress, role }`) that (1) runs the seat pre-check, (2) on pass calls Clerk's Backend API `createOrganizationInvitation`, (3) returns the invitation. Point the UI's invite action at this route instead of calling Clerk directly. `(verify the invite mechanism before choosing a branch)`.

### B. Pre-check helper — `apps/dashboard/src/lib/billing/entitlements.ts`
- Reuse `checkSeatLimit(plan, currentSeats)`. At invite time the current member count has **not** been incremented yet, so pass the **live** member count (no `-1`): `checkSeatLimit(plan, currentMembers)` returns `allowed=false` when `currentMembers >= plan.seats`.
- Resolve current members with the same counting used by `usage.ts`/`clerk.ts` (Clerk org membership count for the owner org). Resolve plan via `getPlanForOwner(owner.id)` from `user-subscription.ts`.

### C. Wire the gate at invite time
- In the invite path (A):
  ```
  const plan = await getPlanForOwner(owner.id)         // fail-open: throws w/o Clerk
  const members = await countOrgMembers(owner.id)
  const check = checkSeatLimit(plan, members)
  if (!check.allowed) return 402 { reason: 'seat', message: limitMessage(check) }
  // else: proceed to create the Clerk invitation
  ```
- **Fail-open:** wrap plan/member resolution so that if it throws (no Clerk), the invite proceeds ungated (OSS/self-hosted-whole).
- The 402 body MUST include `reason: 'seat'` so the plan-15 `PaywallModal` classifies it.

### D. Keep the webhook rollback — `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts`
- **Do not remove** the `organizationMembership.created` → `checkSeatLimit(plan, count - 1)` rollback (`clerk.ts:47–72`). It stays as defense-in-depth for any invite path that bypasses the pre-check (e.g. direct Clerk Dashboard adds). Add a code comment noting the pre-check is primary and this is the fallback.

### E. Enforcement registry — `apps/dashboard/src/lib/billing/plan-enforcement.ts`
- Update `LIMIT_ENFORCEMENT.seats` to `{ status:'enforced', gate:'org/invite.ts pre-check checkSeatLimit; webhooks/clerk.ts rollback as fallback' }`. (Honest-paywall invariant — seats is now genuinely pre-enforced.)

### F. Tests — extend `apps/dashboard/src/lib/billing/seat-enforcement.test.ts` (+ a route test if a route was added)
- **At seats** (`currentMembers === plan.seats`): pre-check `allowed === false` → invite path returns 402 with `reason: 'seat'`.
- **At seats−1**: `allowed === true` → invite proceeds (Clerk create called).
- **fail-open**: plan/member resolution throws (no Clerk) → invite proceeds, no 402.
- **webhook still guards**: existing rollback test remains green (the post-hoc `count - 1` path unchanged).

## STOP conditions & drift check
- **STOP and locate first**: do not assume an invite route exists. Confirm the invite mechanism (server route vs client Clerk component) before adding the gate; choose branch A accordingly.
- **STOP if** `checkSeatLimit`'s semantics are `used <= limit` rather than `used < limit` — the pre-check arg (no `-1`) depends on "room for one more"; verify at `entitlements.ts:86` and adjust the off-by-one to match.
- **STOP if** `getPlanForOwner` is not importable from `user-subscription.ts` — re-locate it (it is also referenced from `retention-owner.ts`/`plan-capability.ts`) before wiring.
- **Drift check:** `webhooks/clerk.ts` still calls `checkSeatLimit(plan, count - 1)` on `organizationMembership.created`. If that rollback is gone, don't remove the fallback — restore/keep it.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/billing/seat-enforcement.test.ts --isolate
bun run lint
```

## Done criteria
- An over-cap invite returns 402 (`reason: 'seat'`) **before** any member is added; the paywall (plan 15) can render it.
- An at-cap-minus-one invite proceeds and creates the Clerk invitation.
- The Clerk `organizationMembership.created` rollback remains intact as defense-in-depth.
- `plan-enforcement.ts` marks `seats` `enforced` with a gate string naming the invite pre-check.
- Fail-open verified (no Clerk → invite proceeds ungated); tests at seats and seats−1 pass; type-check, build, lint green.

Priority: P1 · Effort S · Depth: F · Wave: R (Revenue) · Lever: Adoption (clean seat UX + upgrade prompt)
