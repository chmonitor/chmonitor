# Plan 08: Characterize the retention-prune cron (destructive DELETE + auth gate) with tests

> **Executor instructions**: Follow step by step; verify each step before the
> next. On a "STOP condition", stop and report. When done, update this plan's
> row in `plans/README.md`. This plan adds tests and one tiny test-only export;
> it must NOT change the prune behaviour.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/routes/api/cron/retention-prune.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`GET /api/cron/retention-prune` is the only endpoint that **hard-deletes user data** by
plan (`DELETE FROM conversations WHERE user_id=?1 AND updated_at<?2`), and it is now an
*enforced* gate (`lib/billing/plan-enforcement.ts` classifies `retentionDays` as
`enforced`, naming this file). Yet the handler and its `authorizeCron` gate have **no
test** — `routes/api/cron/__tests__/` holds only `health-sweep.test.ts`. A regression that
breaks the auth (deletes for anyone) or inverts the cutoff (`<` → `>`, deleting *recent*
data) would ship green. The retention *math* (`retentionCutoffMs`,
`resolveRetentionPlanForUser`) is already covered elsewhere; this plan characterizes the
**handler**: the auth gate, the D1-unbound no-op, and the per-user delete/skip loop.

## Current state

File: `apps/dashboard/src/routes/api/cron/retention-prune.ts`. Neither `authorizeCron`
(`:50`) nor `handler` (`:76`) is exported today — only `Route` (`:163`). Behaviour to lock:

- `authorizeCron`: **503** when `CRON_SECRET` unset/empty (`:56-64`, fail-closed);
  authorized when `Authorization: Bearer <secret>` matches via `secretsMatch` (`:67`) or
  `?secret=<secret>` matches (`:71`); **401** otherwise (`:73`). Secret is read as
  `(env.CRON_SECRET ?? process.env.CRON_SECRET)?.trim()`.
- `handler`: if `getPlatformBindings().getD1Database('CHM_CLOUD_D1')` throws or returns
  falsy → `{ skipped: true, reason: 'D1 not bound' }` 200 (`:88-91`). Else: select distinct
  `user_id`s, and per user resolve `plan = resolveRetentionPlanForUser(userId)`,
  `cutoff = retentionCutoffMs(plan)`; **skip** (no delete) when `cutoff == null`
  (enterprise, `:114-117`); else `DELETE … WHERE user_id=?1 AND updated_at<?2` (`:119-124`).
  A user whose resolution/delete throws is counted in `errors` and **skipped, never
  deleted** (`:134-140`). Returns `{ usersProcessed, usersSkipped, totalDeleted, errors }`.

Collaborators to mock: `@chm/platform` (`getPlatformBindings`), `@/lib/billing/retention-owner`
(`resolveRetentionPlanForUser`), `@/lib/billing/entitlements` (`retentionCutoffMs` — may be
used real if convenient). `CRON_SECRET` is controlled via `process.env.CRON_SECRET`.

Test conventions: **Bun test** (`bun:test`), `mock.module` for collaborators — mirror the
mocking style in `apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts:21-74` (stable
wrapper delegating to a per-test `let` binding). The sibling `health-sweep.test.ts` shows
the constant-time-auth expectations and the source-reading fallback.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Run new test | `cd apps/dashboard && bun test src/routes/api/cron/__tests__/retention-prune.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/routes/api/cron/retention-prune.ts` (add ONLY a test-only export; no behaviour change)
- `apps/dashboard/src/routes/api/cron/__tests__/retention-prune.test.ts` (create)

**Out of scope**:
- The prune logic, the cutoff math, `resolveRetentionPlanForUser`, `retentionCutoffMs` — do not modify behaviour.
- `health-sweep.ts` and its test.
- `packages/platform` internals (mock it, don't change it).

## Git workflow

- Branch: `advisor/08-retention-prune-tests`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `test(cron): characterize retention-prune auth + delete loop`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Expose the handler for tests (test-only export, no behaviour change)

At the bottom of `retention-prune.ts`, add `export { handler as __handlerForTests }`
(mirrors the `__handlePostForTests` convention in
`apps/dashboard/src/routes/api/v1/health/webhook.ts:209`). Do not change `handler` or `Route`.

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Write the behavioural characterization test

Create `retention-prune.test.ts`. If `cloudflare:workers` must be stubbed for the import
to resolve under bun, add `mock.module('cloudflare:workers', () => ({ env: {} }))` at the
top. Build a fake D1 whose `prepare(sql)` returns an object with `.all()` (for the
`SELECT DISTINCT user_id`) and `.bind().run()` (for the DELETE, returning
`{ meta: { changes: N } }`), recording the SQL + bound args so tests can assert them.
Control `CRON_SECRET` via `process.env.CRON_SECRET` (set in `beforeEach`, delete for the
503 case). Cases:

1. **503 fail-closed** — `delete process.env.CRON_SECRET`; call the handler → status 503, no D1 access.
2. **401 bad secret** — secret set; request with `Authorization: Bearer wrong` → 401; also `?secret=wrong` → 401.
3. **authorized, D1 unbound no-op** — secret set + correct; mock `getPlatformBindings().getD1Database` to throw (or return null) → 200 `{ skipped: true }`, no DELETE issued.
4. **authorized, prunes with cutoff** — D1 returns 2 distinct users; `resolveRetentionPlanForUser` → a Free plan; `retentionCutoffMs` → a fixed number; assert a `DELETE … updated_at < ?2` is issued **per user** with that cutoff bound, and `totalDeleted` reflects the fake `changes`.
5. **enterprise skipped** — a user whose plan yields `retentionCutoffMs == null` → **no DELETE** for that user; `usersSkipped` incremented.
6. **resolution error → skip, never delete** — `resolveRetentionPlanForUser` throws for one user → that user is counted in `errors`, **no DELETE** issued for them, and the loop continues to the next user.

Assert the correct-secret path via **both** the `Authorization` header and `?secret=`.

**Verify**: `cd apps/dashboard && bun test src/routes/api/cron/__tests__/retention-prune.test.ts --isolate` → all pass; `bun run lint` → exit 0.

### Step 3 (fallback, only if Step 2's import can't be made to work)

If `retention-prune.ts` cannot be imported/mocked in bun (e.g. an unresolvable
`cloudflare:workers` or platform binding), fall back to the structural approach of
`health-sweep.test.ts`: read the source and assert the auth contract (`secretsMatch`
used for both header and query; 503 fail-closed present; DELETE uses `< ?2` not `> ?2`),
and behaviourally test `secretsMatch` directly. Note in the test file header WHY the
behavioural approach was not used. Prefer Step 2 — only use this if Step 2 genuinely can't run.

## Test plan

- New file `retention-prune.test.ts` with the 6 behavioural cases (or the structural fallback).
- Structural pattern: `polar.test.ts` (mocking) + `health-sweep.test.ts` (auth expectations / fallback).
- Verification: `cd apps/dashboard && bun test src/routes/api/cron --isolate` → all pass.

## Done criteria

- [ ] `retention-prune.ts` exports `__handlerForTests` (or the fallback note explains why not) and its runtime behaviour is unchanged (`git diff` shows only the export line added)
- [ ] `cd apps/dashboard && bun test src/routes/api/cron/__tests__/retention-prune.test.ts --isolate` passes with ≥6 assertions covering 503 / 401 / no-op / delete / enterprise-skip / error-skip (or the structural equivalent)
- [ ] `cd apps/dashboard && bun run type-check` exits 0
- [ ] `bun run lint` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The handler's behaviour excerpts don't match the live code (drift).
- Neither Step 2 (behavioural) nor Step 3 (structural) can produce a passing test — report the blocker (likely a module-resolution issue) rather than deleting the finding.
- Writing the test would require changing prune *behaviour* to make it testable — STOP; behaviour must not change.

## Maintenance notes

- Reviewer: confirm the only production change is the `__handlerForTests` export; the DELETE
  still uses `updated_at < cutoff` and skips on `cutoff == null` and on resolution error.
- If a real D1/integration harness is added, promote case 4/6 to run against it.
- Companion gap noted in the audit: `packages/platform`'s bindings resolver is untested. A
  minimal `getPlatformBindings` adapter test is a reasonable follow-up but is out of scope here.
