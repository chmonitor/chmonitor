# Plan 11: Test the Clerk webhook handler end-to-end (seat enforcement + rollback)

> **Executor instructions**: Follow step by step; verify each step. On a "STOP
> condition", stop and report. When done, update this plan's row in
> `plans/README.md`. This plan adds tests + one test-only export; it must NOT
> change handler behaviour.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/routes/api/v1/webhooks/clerk.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`POST /api/v1/webhooks/clerk` enforces the paid-plan **seat cap**: when an
`organizationMembership.created` event would push an org over `plan.seats`, it rolls the new
member back via Clerk's `deleteOrganizationMembership`. This money-path handler has **no
test** — and the seat off-by-one that decides whether a paying org gets over-provisioned is
currently guarded only by `lib/billing/seat-enforcement.test.ts`, which tests a **re-implemented
copy** (`admit = (plan, count) => checkSeatLimit(plan, count - 1)`) and never imports
`clerk.ts`. So changing the real `clerk.ts:72` (dropping the `- 1`) leaves the suite green.
This plan tests the **real handler**, locking the signature check, the config gate, the
enterprise bypass, and the exact seat boundary.

## Current state

File: `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts`. `handlePost` (`:28`) — not yet
exported for tests. Behaviour to lock:
- `getClerkWebhookSecret()` unset → **501** (`:29-35`).
- `verifyWebhook(request, { signingSecret })` throws → **403** (`:38-43`).
- `organizationMembership.created`: `getPlanForOwner(orgId)`; if `plan.seats == null`
  (enterprise) → allow, no membership list, no delete (`:53-56`).
- Else list memberships (`clerkClient().organizations.getOrganizationMembershipList`,
  `limit:100`), `count = memberships.data.length`, then `check = checkSeatLimit(plan, count - 1)`
  (the webhook fires *after* Clerk added the member, so `count` is post-addition and
  `count - 1` is "does the new member fit?"). If `!check.allowed` →
  `deleteOrganizationMembership({ organizationId: orgId, userId })` (`:72-77`).

Collaborators to mock (external I/O only — keep `checkSeatLimit` **real** so the off-by-one
is exercised): `@clerk/tanstack-react-start/webhooks` (`verifyWebhook`),
`@/lib/billing/clerk-webhook-config` (`getClerkWebhookSecret`),
`@/lib/billing/user-subscription` (`getPlanForOwner`), and
`@clerk/tanstack-react-start/server` (`clerkClient` — the handler `import()`s it lazily).

Test conventions: **Bun test**, `mock.module` — `apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts`
is the exact template (it mocks `@clerk/tanstack-react-start/server` the same way). Note its
guidance: mock the **full** export surface of each specifier (a superset) so cross-file mock
registration in one `bun test` process is order-independent, and leave `createFileRoute` un-mocked.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Run new test | `cd apps/dashboard && bun test src/routes/api/v1/webhooks/clerk.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts` (add ONLY a test-only export)
- `apps/dashboard/src/routes/api/v1/webhooks/clerk.test.ts` (create)

**Out of scope**:
- The handler logic and the `count - 1` computation — do NOT change behaviour; the test
  documents the current contract (the seat boundary) so a future change is caught.
- `checkSeatLimit` (`lib/billing/entitlements`) and `seat-enforcement.test.ts` — leave both;
  this plan adds the missing *handler* coverage, it does not replace the unit test.
- `polar.ts` webhook.

## Git workflow

- Branch: `advisor/11-clerk-webhook-handler-tests`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `test(billing): cover the Clerk webhook seat-enforcement handler`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Export the handler for tests

Add `export { handlePost as __handlePostForTests }` at the bottom of `clerk.ts` (mirrors
`health/webhook.ts:209`). No other production change.

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Write the handler test

Create `clerk.test.ts`. Mock the four specifiers above with per-test `let` bindings. A helper
builds a `organizationMembership.created` event (`verifyWebhook` returns it):
`{ type:'organizationMembership.created', data:{ organization:{ id:'org_1' }, public_user_data:{ user_id:'user_new' } } }`.
`getPlanForOwner` returns a plan with a concrete `seats` (e.g. `{ id:'pro', seats:3 }`).
`getOrganizationMembershipList` returns `{ data: Array.from({length: count}) }` to simulate
the post-addition member count. Cases:

1. **501 unconfigured** — `getClerkWebhookSecret` → `undefined` → status 501, `verifyWebhook` not called.
2. **403 bad signature** — `verifyWebhook` throws → status 403.
3. **enterprise bypass** — `getPlanForOwner` → `{ seats: null }` → 2xx, `getOrganizationMembershipList` and `deleteOrganizationMembership` **not** called.
4. **at cap, member fits** — `seats:3`, `count:3` (post-addition, so pre-addition 2 fits) → `deleteOrganizationMembership` **not** called. *(This is the boundary the parallel-copy test can't protect.)*
5. **over cap, rolled back** — `seats:3`, `count:4` → `deleteOrganizationMembership` called **once** with `{ organizationId:'org_1', userId:'user_new' }`.
6. **other event acknowledged** — `type:'user.created'` → 2xx, no membership calls.

**Verify**: `cd apps/dashboard && bun test src/routes/api/v1/webhooks/clerk.test.ts --isolate` → all pass; `bun run lint` → exit 0.

## Test plan

- New `clerk.test.ts` with the 6 cases; keep `checkSeatLimit` real so case 4/5 exercise the actual off-by-one.
- Structural pattern: `polar.test.ts` (mock.module + Clerk server mock).
- Verification: `cd apps/dashboard && bun test src/routes/api/v1/webhooks/clerk.test.ts --isolate` → all pass.

## Done criteria

- [ ] `clerk.ts` exports `__handlePostForTests`; runtime behaviour unchanged (`git diff` shows only the export line)
- [ ] `clerk.test.ts` covers 501 / 403 / enterprise-bypass / at-cap-allowed / over-cap-rolledback / other-event
- [ ] Case 4 (count === seats → NOT rolled back) and case 5 (count === seats+1 → rolled back) both assert `deleteOrganizationMembership`'s call count
- [ ] `cd apps/dashboard && bun test src/routes/api/v1/webhooks/clerk.test.ts --isolate` passes
- [ ] `cd apps/dashboard && bun run type-check` exits 0; `bun run lint` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The handler's seat logic differs from the excerpt (drift) — especially if `count - 1` has
  already changed; if so, write the test against the CURRENT behaviour and flag the change.
- `verifyWebhook` / `clerkClient` cannot be mocked via `mock.module` in this runtime — report
  the blocker (check how `polar.test.ts` handles the same specifiers).
- The lazy `import('@clerk/tanstack-react-start/server')` resolves to a real network call in
  test despite the mock — STOP and report.

## Maintenance notes

- Reviewer: confirm cases 4 and 5 pin the seat boundary (`count === seats` vs `count === seats + 1`)
  — this is the regression the existing `seat-enforcement.test.ts` cannot catch because it
  tests a copy of the logic, not `clerk.ts`.
- If seat enforcement moves to a different event or the `count - 1` reasoning changes, update
  these cases in lockstep.
