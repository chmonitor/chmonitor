# Plan 78: De-duplicate and test the constant-time secret comparators

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/auth`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security / tests
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2495

## Why this matters

`lib/auth/providers/constant-time.ts` exists — per its own header — so the
security-critical timing-safe comparator can't "drift apart" between auth
providers. Yet `lib/auth/agent-api-token.ts` already carries a **verbatim
inline copy**, and neither has any test. A silent regression to a
non-constant-time or length-leaking form would be invisible.

## Current state

`apps/dashboard/src/lib/auth/providers/constant-time.ts` (shared, documented):

```ts
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index]
  return diff === 0
}
```

Also exports `secretsMatch` (read the file). Used by the `proxy` and `trusted`
auth providers.

`apps/dashboard/src/lib/auth/agent-api-token.ts:3-13` — identical private
`constantTimeEqual` copy, used for Bearer-token auth on the agent API.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/lib/auth` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `agent-api-token.ts` (replace inline copy with shared import),
new tests `providers/constant-time.test.ts` and `agent-api-token.test.ts`.

**Out of scope**: the comparator algorithm itself; provider auth flows;
`packages/mcp-server` auth (its `getBearerToken` import stays).

## Git workflow

- Branch: `advisor/78-constant-time-auth-dedupe`
- Commit: `refactor(auth): share constantTimeEqual + add truth-table tests`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Tests first (against the shared module)
`constant-time.test.ts`: equal buffers → true; one-byte diff → false;
length mismatch → false; empty vs empty → true; empty vs non-empty → false.
Same table for `secretsMatch` (string inputs; check its encoding path).
**Verify**: `bun test src/lib/auth/providers/constant-time.test.ts` → pass.

### Step 2: Replace the inline copy
In `agent-api-token.ts`, delete the private `constantTimeEqual` and import from
`@/lib/auth/providers/constant-time`. No behaviour change.
**Verify**: `rg -n "constantTimeEqual" apps/dashboard/src/lib/auth` → exactly one definition (the shared module); `pnpm run build` exit 0.

### Step 3: Token-validation tests
`agent-api-token.test.ts`: env token unset → reject; wrong token → reject;
correct token → accept. Stub env the way other `lib/auth` tests do (check for
existing patterns in `src/lib/auth/**/*.test.ts`).
**Verify**: `bun test src/lib/auth` → all pass.

## Done criteria

- [ ] One `constantTimeEqual` definition repo-wide in the dashboard app
- [ ] Truth-table + token tests pass; build exit 0
- [ ] `plans/README.md` updated

## STOP conditions

- `agent-api-token.ts` runs in a context that cannot import from
  `providers/constant-time` (bundle/layer boundary) — report; do not copy again.

## Maintenance notes

- Any third consumer of timing-safe comparison must import the shared module;
  the "one definition" grep in Done criteria is the review check.
