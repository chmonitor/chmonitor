# Plan 74: Unify hostId validation (root search param + duplicate validators)

> **Executor instructions**: Follow step by step; verify each step. STOP
> conditions are binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/routes/__root.tsx apps/dashboard/src/lib/clickhouse-helpers.ts apps/dashboard/src/lib/api/shared/validators/host-id.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (callers relying on silent host-0 fallback start erroring)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2491

## Why this matters

Three inconsistent hostId validations produce contradictory behaviour:

1. The root route accepts junk: `?host=-5` and `?host=1.5` flow into the app
   and produce error states downstream instead of defaulting to host 0.
2. Two same-named `validateHostId` functions disagree: one silently coerces any
   invalid input to host `0` (can serve host-0 data for a request that meant a
   different host); the other rejects with an error — but uses `parseInt`, so
   `"2abc"` passes as `2`.

## Current state

`apps/dashboard/src/routes/__root.tsx:55-61`:

```ts
function validateSearch(search: Record<string, unknown>): RootSearch {
  const raw = search.host
  const parsed = Number(raw)
  return {
    host:
      raw === undefined || raw === null || Number.isNaN(parsed) ? 0 : parsed,
  }
}
```

`apps/dashboard/src/lib/clickhouse-helpers.ts:69` (used by `fetchDataWithHost`,
line ~35): string not matching `/^\d+$/` → logs a warning → **returns 0**.

`apps/dashboard/src/lib/api/shared/validators/host-id.ts:29-41`:

```ts
export function validateHostId(hostId: string | null): number {
  if (!hostId) throw new Error('Missing required parameter: hostId')
  const parsed = parseInt(hostId, 10)   // "2abc" → 2
  if (Number.isNaN(parsed) || parsed < 0) throw new Error('Invalid hostId: ...')
  return parsed
}
```

Note: negative hostIds ARE legitimate client-side (browser/database
connections use negative ids — see `lib/host-fetch/resolve-host-fetch.ts`,
`isCustomHost = hostId < 0`), but the **root search validator** should still
only accept integers, and the **server-side** validators correctly reject
negatives (server never serves negative ids; those resolve client-side).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build   | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests   | `cd apps/dashboard && bun test src/lib src/routes` | all pass |

## Scope

**In scope**: `routes/__root.tsx` (validateSearch), `lib/api/shared/validators/host-id.ts`
(strict integer parse), `lib/clickhouse-helpers.ts` (stop silent coercion),
callers of `fetchDataWithHost` that would newly receive errors, tests.

**Out of scope**: negative-id client resolution (`resolve-host-fetch.ts`) —
correct as is; `useHostId` hook.

## Git workflow

- Branch: `advisor/74-host-id-validation-unification`
- Commit: `fix(routing): unify hostId validation, stop silent host-0 coercion`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Tighten the root search validator
`?host` must be a finite integer; anything else → 0. Keep negatives (client
connection ids are negative):
`host: Number.isInteger(parsed) ? parsed : 0`.
**Verify**: `bun test src/routes` passes; add the test in Step 4 first if TDD preferred.

### Step 2: Strict parse in `host-id.ts`
Replace `parseInt` with a full-string check (`/^\d+$/` then `Number`), so
`"2abc"` is rejected. Keep the throwing/ApiError contract unchanged.
**Verify**: existing tests for this validator (if any) still pass.

### Step 3: Remove the silent coercion in `clickhouse-helpers.ts`
`validateHostId` there should throw (or return a discriminated error via the
file's existing error shape — read how `fetchDataWithHost` reports errors and
match it) instead of returning 0 for invalid input. First enumerate callers:
`rg -n "fetchDataWithHost|validateHostId" apps/dashboard/src --type ts` and
confirm each caller passes an already-validated hostId. If any caller
deliberately relies on the default-to-0 (e.g. missing hostId → 0), preserve
"undefined/null → 0" and only reject *malformed* values.
**Verify**: `pnpm run build` exit 0; `bun test src/lib` all pass.

### Step 4: Tests
Table-test all three: root search (`-5` kept, `1.5` → 0, `"abc"` → 0, `"3"` → 3),
strict validator (`"2abc"` rejected), helpers (malformed throws, undefined → 0).
**Verify**: `bun test` on the three test files → pass.

## Done criteria

- [ ] `?host=1.5` and `?host=abc` resolve to 0; `?host=-2` preserved
- [ ] `"2abc"` rejected by the API validator
- [ ] No silent malformed→0 coercion remains (`rg "return 0" apps/dashboard/src/lib/clickhouse-helpers.ts` only on the undefined/null branch)
- [ ] Build + targeted tests green; `plans/README.md` updated

## STOP conditions

- More than ~5 call sites depend on the silent coercion — the blast radius is
  bigger than planned; report the list instead of changing them all.
- Root search validator is covered by an e2e/cypress snapshot that encodes the
  old junk-passthrough behaviour.

## Maintenance notes

- Reviewer: watch for URLs in the wild with `?host=NaN`-ish junk (analytics may
  show some) — they now land on host 0 rather than erroring; that's intended.
