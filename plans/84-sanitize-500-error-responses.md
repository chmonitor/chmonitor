# Plan 84: Stop returning raw backend error messages on 500 responses

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- "apps/dashboard/src/routes/api/dashboards/share.\$slug.ts" apps/dashboard/src/routes/api/v1/browser-connections/proxy.ts apps/dashboard/src/routes/api/v1/user-connections.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (error text only; server logs keep detail)
- **Depends on**: none
- **Category**: security (data minimization)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2501

## Why this matters

Several API catch-blocks pass raw backend error `.message` strings (D1 /
ClickHouse / driver internals) to clients. On the **unauthenticated** public
share-link route this leaks internal detail to anyone; on authenticated routes
it still exposes internals users shouldn't see. Detail already goes to server
logs (the share route even generates a `requestId`), so nothing is lost by
sanitizing the response.

## Current state

`apps/dashboard/src/routes/api/dashboards/share.$slug.ts:122-147` — both the
`DashboardStoreError` branch and the generic branch return `err.message` in a
500 `createApiErrorResponse` to an unauthenticated caller:

```ts
} catch (err) {
  error('[GET /api/dashboards/share/$slug] Error:', err, { requestId })
  if (err instanceof DashboardStoreError) {
    return createApiErrorResponse({ type: ApiErrorType.QueryError, message: err.message, ... }, 500, ROUTE_CONTEXT)
  }
  const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
  return createApiErrorResponse({ ..., message: errorMessage, ... }, 500, ROUTE_CONTEXT)
}
```

Same pattern: `routes/api/v1/browser-connections/proxy.ts` (~lines 155-166),
`routes/api/v1/user-connections.ts` (~lines 213-225), and similar `/api/v1/*`
catch blocks (sweep with the grep in Step 1).

`createApiErrorResponse` lives in the shared API error module (grep
`createApiErrorResponse` under `apps/dashboard/src/lib/api` — that's where the
sanitizer belongs so all routes inherit it).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Sweep | `rg -n "err.message|errorMessage" apps/dashboard/src/routes/api -S` | list of sites |
| Tests | `cd apps/dashboard && bun test src/lib/api src/routes/api` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: the shared error-response helper (add sanitization), the three
named routes + any other `/api/*` catch block surfaced by the sweep that sends
`err.message` on a 5xx, tests.

**Out of scope**: 4xx validation messages (intentionally specific, e.g.
"Invalid hostId" — keep); `lib/connection-errors.ts` classification (that IS
the sanitizer for connection tests — don't touch); UI error components.

## Git workflow

- Branch: `advisor/84-sanitize-500-error-responses`
- Commit: `fix(api): return generic messages with request ids on 500s`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Add a sanitizing path to the shared helper
In the module defining `createApiErrorResponse`, add
`createInternalErrorResponse(err, routeContext, requestId?)`: logs the real
error (existing logger), returns a generic message
(`'Internal error'` + `requestId` in `details`). 5xx only.
**Verify**: `bun test src/lib/api` pass; build green.

### Step 2: Convert the catch blocks
Convert the three named routes + swept 5xx sites to the new helper. Keep any
route-specific classification that maps KNOWN error types to user-actionable
messages (e.g. connection-error classification) — only the raw passthrough
goes.
**Verify**: `rg -n "message: err(orMessage)?\.?message" apps/dashboard/src/routes/api` (adjust pattern to your sweep) → no 5xx raw passthroughs remain.

### Step 3: Tests
For the shared helper: given `new Error('D1_ERROR: no such table users_v2')`,
the response body contains neither `D1_ERROR` nor `users_v2`, includes the
generic message, and the logger received the original. Add one route-level test
for the share route if a test harness for it exists (check
`routes/api/dashboards/__tests__/`).
**Verify**: `bun test src/lib/api src/routes/api` → all pass.

## Done criteria

- [ ] No `/api/*` 5xx response carries raw `err.message` (sweep clean)
- [ ] Helper test proves sanitization + logging
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- A frontend component string-matches specific 500 messages to drive UX (grep
  the message literals in `src/components` before changing each route) — report
  those couplings instead of breaking them.

## Maintenance notes

- New routes should use `createInternalErrorResponse` in catch blocks; reviewer
  checks catch blocks in API PRs for raw `.message` passthrough.
