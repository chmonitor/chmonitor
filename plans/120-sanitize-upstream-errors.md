# Plan 120: Sanitize upstream ClickHouse error text on the remaining query routes (execute plan 84)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/routes/api/v1/ apps/dashboard/src/lib/api/error-handler/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (over-aggressive classification could hide useful validation errors; keep raw text server-side logged)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3315

## Why this matters

Round-4 plan 84 (`plans/84-sanitize-500-error-responses.md`) is still open:
raw upstream error text reaches clients on major query routes —
`routes/api/v1/data.ts:139` forwards `queryError.message` verbatim;
`explorer/query.ts:191` forwards `result.error.message`. `lib/api/error-handler/sanitize-error.ts`
exists but only ~14 route files adopt it vs dozens of query-executing routes.
Internal topology leaks to browsers and holders of stolen `chm_` tokens:
hostnames/ports of configured ClickHouse servers, internal table/column names,
version/banner fragments.

This plan executes 84 against current code with the two highest-traffic
surfaces prioritized. Plan 84's original file remains as background; THIS file
supersedes it for execution.

## Current state

`apps/dashboard/src/routes/api/v1/data.ts:130–145` (excerpt):

```ts
  const apiErrorType = errorTypeMap[queryError.type] ?? ApiErrorType.QueryError

  return createApiErrorResponse(
    {
      type: apiErrorType,
      message: queryError.message,
      details: queryError.details as Record<...>,
    },
    mapErrorTypeToStatusCode(apiErrorType),
```

Sanitizer: `lib/api/error-handler/sanitize-error.ts:35`
(`sanitizeClickHouseError`) — read its signature and classification table
first; ~14 routes already use it (grep to list them as pattern references).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Targeted tests | `cd apps/dashboard && bun test src/lib/api/__tests__ src/routes/api/v1/__tests__ --isolate` | pass |
| Full unit | `pnpm run test:unit` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- Query-executing routes under `src/routes/api/v1/**` that return raw upstream
  messages (start with `data.ts`, `explorer/query.ts`, then sweep the rest by grep)
- Tests asserting sanitization on the top routes

**Out of scope**:
- The sanitizer module itself (unless a class is missing — extend ONLY with tests + one mapping row if trivially needed)
- Non-query routes without upstream text
- Client-side error rendering

## Git workflow

- Branch: `advisor/120-sanitize-upstream-errors`
- Commit: `fix(api): route client-facing query errors through sanitizeClickHouseError`

## Steps

1. Grep inventory: `rg -n "message: .*error\.message|message: queryError\.message|error\.message }" apps/dashboard/src/routes/api/v1 --glob '*.ts' | grep -v test | head -40`. Cross out files already calling sanitizeClickHouseError.
2. For each remaining route returning a client-facing `message`, wrap through
   `sanitizeClickHouseError(...)` per its existing usage exemplars; keep raw
   detail in server logs (most call sites already console.error before
   responding — verify one).
3. Prioritize `data.ts` + `explorer/query.ts` first, commit, then batch the rest.
4. Tests: for data.ts and explorer/query.ts, feed a mocked upstream error
   containing a fake hostname + table name; assert response message contains
   neither. Pattern: existing sanitize-error tests.

## Done criteria

- [ ] Inventory grep shows zero unguarded client-facing upstream messages in api/v1 (excluding deliberate exceptions documented in NOTES)
- [ ] New tests green; full unit suite green; type-check green

## STOP conditions

- A route intentionally returns raw errors as an API contract (e.g., SQL editor preview needs exact engine errors) → leave it, add to NOTES with justification instead of wrapping.
- Sanitizer misclassifies a common benign case surfaced by existing tests → STOP and report the failing case rather than loosening the sanitizer ad hoc.

## Maintenance notes

- New API routes must import the sanitizer — consider noting in
  docs/knowledge/conventions.md as follow-up.
- Reviewers: confirm no UX regression where users legitimately need engine
  hints (the classifier keeps friendly categories).
