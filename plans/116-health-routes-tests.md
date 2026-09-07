# Plan 116: Tests for alert-routing CRUD and its write-auth gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/routes/api/v1/health/routes.ts apps/dashboard/src/lib/health/alert-routing-auth.ts`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / security-adjacent
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3311

## Why this matters

`/api/v1/health/routes` (405 lines: POST/DELETE CRUD for webhook/Telegram/
PagerDuty alert channels, owner scoping, secret masking) has NO route tests,
and its policy module `lib/health/alert-routing-auth.ts` — the cloud-vs-OSS
write gate `requiresSignInForWrite()` — has no direct test either. Plans
28–33 compose onto exactly this surface (the plans/README conflict cascade),
and a regression that lets anonymous visitors register cross-user channels or
leaks PagerDuty routing keys / Telegram bot tokens through unmasked responses
would ship with zero CI signal. Five sibling health routes (`ack`,
`maint-windows`, `quiet-hours`, `alert-state`, `findings`) are equally bare;
this plan covers the two highest-risk files and leaves siblings as follow-up.

## Current state

- `apps/dashboard/src/routes/api/v1/health/routes.ts` — POST/DELETE handlers;
  owner scoping; masking helpers `maskRoutingKey` (:52–56) + token maskers
  (:80–101).
- `apps/dashboard/src/lib/health/alert-routing-auth.ts:26–48` —
  `requiresSignInForWrite()`: returns false unless Clerk configured AND owner
  '' (cloud-mode gate).
- Existing patterns: pure-store tests at `lib/health/alert-routing.test.ts`;
  route-level exemplar `routes/api/v1/webhooks/polar.test.ts`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| New tests | `cd apps/dashboard && bun test src/lib/health src/routes/api/v1/health --isolate` | pass |
| Full unit | `pnpm run test:unit` | pass |

## Scope

**In scope**:
- NEW `apps/dashboard/src/routes/api/v1/health/__tests__/routes.test.ts`
- NEW `apps/dashboard/src/lib/health/alert-routing-auth.test.ts`

**Out of scope**:
- Any source change to routes.ts or the auth module (characterization only)
- Sibling health endpoints (ack/maint-windows/quiet-hours/alert-state/findings)
  — record as follow-up candidates in NOTES if time remains, don't start.

## Git workflow

- Branch: `advisor/116-health-routes-tests`
- Commit: `test(health): cover alert-routing CRUD, masking, and write-auth gate`

## Steps

1. Policy table-test (`alert-routing-auth.test.ts`): matrix over provider
   config × anonymous → expected `requiresSignInForWrite` result. Stub env via
   the module's own read pattern.
2. Route tests (`routes.test.ts`), mocking stores per polar.test.ts style:
   - POST without sign-in when gate requires it → 401.
   - POST when gate open (OSS mode) → created, scoped to resolved owner.
   - DELETE another owner's id → not found / forbidden (assert actual code).
   - GET degrades to 200 [] without D1 binding.
   - Masking: create a routing entry with known Telegram/PagerDuty secrets;
     every GET/POST response field must NOT contain more than the mask allows
     (assert no full secret substring appears anywhere in response JSON).
3. Battery green.

## Done criteria

- [ ] Both new test files exist and pass; ≥10 branch assertions total
- [ ] Zero source diffs outside test files

## STOP conditions

- Handlers can't be driven without live Clerk/D1 even with mocks after honest effort → fall back to testing the pure store + auth-module only; report what remained unreachable.

## Maintenance notes

- When plans 28–33 land here, these tests are the tripwire for cross-user or
  masking regressions.
