# Plan 09: Escape literals and validate privilege/target in RBAC management DDL

> **Executor instructions**: Follow step by step; verify each step. On a "STOP
> condition", stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/security/management-ddl.ts apps/dashboard/src/routes/api/v1/management.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

The RBAC management DDL builder interpolates request-supplied values into ClickHouse
statements with incomplete escaping. `escapeLiteral` (`management-ddl.ts:18-20`) escapes
only `'`, **not** `\` — so a value ending in a backslash breaks out of an
`IDENTIFIED BY '…'` / `HOST IP '…'` literal. And `generateGrantPrivilegeDdl`
(`:121-131`) interpolates `${privilege}` and `${on}` **raw**, with no allowlist or
identifier check, straight from the request body (`management.ts:166-180`). This is a
DDL-injection primitive against the monitored cluster's access-control model. It is
**bounded** — the route requires `CLICKHOUSE_MANAGEMENT_ENABLED=true` (off by default,
`management.ts:52-63`) and passes `authorizeFeatureRequest(ACTIONS…)`, and the caller is
already an RBAC admin — so this is defensive hardening, not a pre-auth hole. The fix:
escape backslashes, and validate the privilege token and grant target instead of
interpolating them raw.

## Current state

Files:
- `apps/dashboard/src/lib/security/management-ddl.ts` — the pure DDL builders. `escapeLiteral` (`:18-20`), `generateGrantPrivilegeDdl` (`:121-131`), `generateRevokePrivilegeDdl` (`:133+`), `quoteId` (`:13-15`, already correctly backtick-escapes).
- `apps/dashboard/src/routes/api/v1/management.ts` — the route. `grant_privilege`/`revoke_privilege` read `getString(params,'privilege')` and `getString(params,'on')` from the request and pass them into the builders (`:166-192`).
- `apps/dashboard/src/lib/sql-utils.ts:21` — **existing** `validateIdentifier(name)` — reuse it for the grant-target parts (do not write a new identifier validator).
- `apps/dashboard/src/lib/security/management-ddl.test.ts` — existing tests (uses `bun:test`, `it`, imports the `generate*` fns). Extend it.

The two defects:

```ts
// management-ddl.ts:18 — misses backslash, so `x\` breaks out of the '…' literal
function escapeLiteral(s: string): string { return s.replace(/'/g, "\\'") }

// management-ddl.ts:126 — privilege and on interpolated raw
let ddl = `GRANT ${privilege} ON ${on} TO ${quoteId(toUser)}`
```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Run test | `cd apps/dashboard && bun test src/lib/security/management-ddl.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/lib/security/management-ddl.ts`
- `apps/dashboard/src/lib/security/management-ddl.test.ts`

**Out of scope**:
- `management.ts` route wiring — the builders throw on invalid input; the route already
  wraps operations in try/catch and returns an error response, so no route edit is needed.
  (If you find the route swallows the throw silently, note it and STOP — do not refactor it here.)
- `quoteId` — already correct; don't touch.
- Turning management on by default / the feature gate.

## Git workflow

- Branch: `advisor/09-management-ddl-injection`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `fix(security): escape literals and validate privilege/target in management DDL`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Fix `escapeLiteral` to escape backslashes before quotes

```ts
function escapeLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}
```

Order matters: backslash first, then quote (so the quote's escape backslash isn't doubled).

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Validate the grant target (`on`) and privilege token

Add two guards used by `generateGrantPrivilegeDdl` and `generateRevokePrivilegeDdl`:

- **`on`** — split on `.`; each part must be `*` or pass `validateIdentifier` (imported from
  `@/lib/sql-utils`). Accept the forms `*`, `*.*`, `db.*`, `db.table` (1 or 2 parts). Throw
  `Error('Invalid grant target')` otherwise. Rebuild `on` from the validated parts (quote
  non-`*` parts with `quoteId`) rather than interpolating the raw string.
- **`privilege`** — must match a conservative pattern for a ClickHouse privilege keyword with
  an optional column list: `^[A-Za-z][A-Za-z ]*(\([A-Za-z0-9_, ]+\))?$` (e.g. `SELECT`,
  `ALTER UPDATE`, `SELECT(col1, col2)`, `ALL`). Throw `Error('Invalid privilege')` otherwise.
  (Reject anything containing quotes, semicolons, backticks, or backslashes.)

Apply both in `generateGrantPrivilegeDdl` (and the revoke variant) before building the string.

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 3: Extend the tests

In `management-ddl.test.ts` add cases:

1. **backslash literal is neutralized** — `generateCreateUserDdl({ username:'u', password:"a\\" })`
   (a password ending in a backslash) produces a statement whose `IDENTIFIED BY '…'` literal
   is properly closed (the generated string contains `\\\\` for the backslash and does not
   end the literal early). Assert the doubled backslash is present and the DDL still ends with
   the expected trailing clause, not truncated.
2. **injection in `on` is rejected** — `generateGrantPrivilegeDdl({ privilege:'SELECT', on:"a TO attacker; --" }, 'victim')` throws `Invalid grant target`.
3. **injection in `privilege` is rejected** — `generateGrantPrivilegeDdl({ privilege:"SELECT'; DROP", on:'db.t' }, 'u')` throws `Invalid privilege`.
4. **valid inputs still work** — `{ privilege:'SELECT', on:'db.events' }` → `GRANT SELECT ON \`db\`.\`events\` TO \`u\``; `{ privilege:'ALL', on:'*.*' }` → `GRANT ALL ON *.* TO \`u\``; a column-list privilege `SELECT(col1, col2)` is accepted.

**Verify**: `cd apps/dashboard && bun test src/lib/security/management-ddl.test.ts --isolate` → all pass; `bun run lint` → exit 0.

## Test plan

- Extend `management-ddl.test.ts` with the 4 cases above (mirror its existing `describe`/`it` blocks).
- Verification: `cd apps/dashboard && bun test src/lib/security/management-ddl.test.ts --isolate` → all pass, incl. the new cases.

## Done criteria

- [ ] `escapeLiteral` escapes `\` then `'`
- [ ] `generateGrantPrivilegeDdl`/`generateRevokePrivilegeDdl` reject malformed `privilege`/`on` and quote the target via `quoteId`
- [ ] New tests cover backslash-breakout, `on` injection, `privilege` injection, and valid inputs
- [ ] `cd apps/dashboard && bun test src/lib/security/management-ddl.test.ts --isolate` passes
- [ ] `cd apps/dashboard && bun run type-check` exits 0 and `bun run build` exits 0
- [ ] `bun run lint` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The management route or UI legitimately sends privilege/target strings that the Step 2
  patterns reject (check `management.ts` callers and any admin UI that builds these params).
  If a real, valid input is rejected, widen the pattern minimally and note it — do not
  loosen it to allow quotes/semicolons/backticks.
- `validateIdentifier` is not at `@/lib/sql-utils` or has a different contract (drift).
- The route swallows a thrown builder error without surfacing it (would hide the validation).

## Maintenance notes

- Reviewer: confirm no request-derived value reaches a DDL string without going through
  `quoteId` (identifiers) or `escapeLiteral` (literals) or the new privilege/target guards.
- ClickHouse has many privilege keywords; the pattern is intentionally conservative. If a
  new legitimate privilege form is needed later, extend the regex with a test, don't remove it.
- This does not change the `CLICKHOUSE_MANAGEMENT_ENABLED` gate — management stays off by default.
