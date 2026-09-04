# Plan 115: Route-level tests for the API-key issuance endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/routes/api/v1/auth/api-key.ts`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3310

## Why this matters

`POST /api/v1/auth/api-key` converts an authenticated session (or an admin
bearer secret) into long-lived `chm_` API credentials for MCP/CLI — and it has
ZERO route-level tests (no co-located test, no `__tests__`). Untested logic
includes the hand-rolled constant-time compare (`timingSafeEqualString`,
:31–45), issuer resolution (`resolveIssuerSub` :70–110: secret path pins
`sub:'cli'`, session path, provider-none → 401), scope allowlisting
(`normalizeScopes` :48–66), days validation (:146–149), and the rule that
secret-auth callers may choose `sub` while session-auth cannot (:151). A
regression here silently broadens who can mint keys — exactly what the still-open
plan 78 worries about.

## Current state

Route file `apps/dashboard/src/routes/api/v1/auth/api-key.ts` (~168 lines):
exports the TanStack route handler; internal helpers listed above; issues keys
via `issueApiKey` from `@chm/mcp-server/auth`.

Package-level reference test to port patterns from:
`packages/mcp-server/src/__tests__/api-key.test.ts` (issue/verify round-trip,
rejects-when-unconfigured).
Route-level structural exemplar:
`apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts`
(createFileRoute-real + mock collaborators via `mock.module`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| New tests | `cd apps/dashboard && bun test src/routes/api/v1/auth --isolate` | pass incl. new file |
| Full unit | `pnpm run test:unit` | pass |

## Scope

**In scope**:
- NEW test file `apps/dashboard/src/routes/api/v1/auth/api-key.test.ts`

**Out of scope**:
- ANY change to api-key.ts itself (pure characterization)
- mcp-server package code/tests
- plan 78 comparator dedupe

## Git workflow

- Branch: `advisor/115-api-key-route-tests`
- Commit: `test(auth): cover api-key issuance route branches`

## Steps

1. Write the test file covering, with `mock.module` for
   `@chm/mcp-server/auth.issueApiKey` and env stubbing:
   - 401 when provider is `none` and no valid bearer secret.
   - 401 when bearer secret mismatches (wrong value).
   - 200/valid-shape when correct admin secret presented; asserts issued sub === 'cli' and requested label ignored... OR body-supplied sub honored per :151 — READ the actual branch first and assert REAL behavior (characterization, not intent).
   - Session path: mock session auth success → 200; failure → 401; asserts session caller CANNOT set arbitrary sub.
   - 400 invalid JSON body; 400 bad `days`; scopes filtered to allowlist by normalizeScopes.
2. Keep every assertion tied to observable response status/JSON shape.
3. Run battery; iterate only on test bugs, never source edits.

## Done criteria

- [ ] Test file exists with ≥8 meaningful branch assertions (list them in PR body)
- [ ] Targeted + full suites green
- [ ] Zero source-file diffs (`git diff --name-only` shows only the new test)

## STOP conditions

- Handler internals are not importable/mockable at route level without refactoring source → use whatever public surface exists; if truly untestable black-box, write integration-style through the route export; if STILL blocked, STOP.
- Discovering an ACTUAL bug in the handler → do NOT fix; record it in the report as a finding and finish characterization around current behavior unless trivially out of scope.

## Maintenance notes

- These tests pin current behavior; if plan 78 later changes comparators or
  plan-enforcement changes sub rules, update assertions deliberately.
