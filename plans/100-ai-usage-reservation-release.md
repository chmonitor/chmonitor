# Plan 100: Investigate — AI daily-usage reservation leak on the stream onError path

> **Executor instructions**: INVESTIGATE-then-fix plan. Step 1's tracing decides
> whether a fix ships; if reachability can't be established, deliver the
> writeup and STOP. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/routes/api/v1/agent.ts`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (idempotent release with a guard flag)
- **Depends on**: none
- **Category**: business-logic / investigate
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2517

## Why this matters

The agent route reserves a daily message slot (`reserveAiUsage`) before
generation and guarantees "aborted requests never consume quota" by releasing
(`releaseAiUsage`) when generation produced nothing. But the release only runs
in the inner `execute` catch (`usageSteps.length === 0` branch); the AI SDK's
separate `onError` stream callback classifies and returns the error **without
releasing**. If a failure surfaces via `onError` after the reservation (thrown
inside the SDK's streaming loop rather than the inner try), the user is charged
a daily message for a request that produced nothing.

## Current state

`apps/dashboard/src/routes/api/v1/agent.ts` (line references at the planned-at
commit; the file is large — locate by grep):

- ~line 587: `reserveAiUsage(...)` (grep `reserveAiUsage`)
- ~lines 859-862: inner catch — `releaseAiUsage` when `usageSteps.length === 0`
- ~line 866: `onError` stream callback — no release

`releaseAiUsage` floors at 0 (`lib/billing/ai-usage-store.ts`) — so a double
release would over-refund one slot; any fix needs a "released once" guard.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/routes/api/v1 src/lib/billing` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `agent.ts` error/release paths; a focused test if the repo's
agent-route test harness supports error injection (check
`src/routes/api/v1/__tests__` and the agent eval tests from plans/51).

**Out of scope**: the reservation/meter store logic; retry semantics; monthly
USD budget paths.

## Steps

### Step 1: Trace which failures reach `onError` vs the inner catch
Read the streaming setup in `agent.ts` (the `streamText`/`createUIMessageStream`
composition) and the AI SDK's error routing for: provider HTTP errors, tool
execution throws, mid-stream aborts, pre-first-token failures. Answer: can an
error bypass the inner catch AND fire `onError` after `reserveAiUsage`?
Document with line citations.
**Verify**: written trace in the PR/plan-update.

### Step 2 (only if reachable): Idempotent release
Hoist `let usageReleased = false` next to the reservation; a
`releaseReservationOnce()` helper called from BOTH the inner no-output catch and
`onError` (only when no output was produced — mirror the `usageSteps.length === 0`
condition available in that scope).
**Verify**: build green; existing agent tests pass; add an error-injection test
if the harness allows (else document manual verification).

## Done criteria

- [ ] Reachability answer documented with citations
- [ ] If reachable: single-release guard in both paths, tests green
- [ ] `plans/README.md` updated (mark REJECTED with the trace if unreachable)

## STOP conditions

- The streaming composition makes the release-once state unshareable between
  the two callbacks (different closures/requests) — report the structure.

## Maintenance notes

- Any future error-path refactor in `agent.ts` must preserve "no output → no
  daily charge"; the guard helper is the anchor to keep.
