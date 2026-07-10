# Plan 95: Test the platform binding-resolution adapters

> **Executor instructions**: Test-only plan — no production changes. Follow
> steps; verify each. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- packages/platform/src`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (pairs naturally before plan 96's spike)
- **Category**: tests
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2512

## Why this matters

`packages/platform` is the single choke point every D1-backed store
(connections, conversations, insights, billing subscription, health) resolves
its database through — and it has **zero tests**. Its Cloudflare adapter
swallows errors and returns `null` on a missing binding, which downstream
degrades every store to "not configured" with no signal. These null-on-missing
/ null-on-throw branches are trivial to test and currently unverified; they're
also the safety net plan 96 (replacing `getCloudflareContext`) will rely on.

## Current state

`packages/platform/src/adapters/cloudflare.ts` — `CloudflarePlatformBindings`:
`getD1Database(bindingName)` returns the binding from
`getCloudflareContext()?.env` when present, `null` when absent, and `null`
(not throw) when the context getter throws (~lines 20-35, same shape for
`getDurableObjectNamespace`). The file header says it is "the ONLY file that
should import from `@opennextjs/cloudflare`".
`packages/platform/src/adapters/memory.ts` — the non-CF fallback.
No `*.test.ts` under `packages/platform`.

Check `packages/platform/package.json` for its test script; other packages
(e.g. `packages/pricing`, `packages/sql-builder`) have bun test setups to copy.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Package tests | `cd packages/platform && bun test` | all pass |
| Root packages tests (if wired via turbo) | `pnpm run test` | pass |

## Scope

**In scope** (create): `packages/platform/src/adapters/cloudflare.test.ts`,
`memory.test.ts`; a `test` script in its package.json if absent (copy a sibling
package's).

**Out of scope**: production adapter code; replacing `getCloudflareContext`
(plan 96).

## Git workflow

- Branch: `advisor/95-platform-adapter-tests`
- Commit: `test(platform): cover binding resolution null/throw branches`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: cloudflare.test.ts
Mock `@opennextjs/cloudflare`'s `getCloudflareContext` (bun `mock.module`):
- env has the binding → returned as-is
- env lacks the binding → `null`
- getter throws → `null`, no throw
Cover both `getD1Database` and `getDurableObjectNamespace`.
**Verify**: `bun test` in the package → pass.

### Step 2: memory.test.ts
Same contract table for the memory adapter (read the file first for its
seeding interface — assert get-after-set and missing-name → null).
**Verify**: `bun test` → all pass.

## Done criteria

- [ ] Both adapters' null/throw branches tested
- [ ] `git diff` shows only tests (+ package.json test script if added)
- [ ] `plans/README.md` updated

## STOP conditions

- `mock.module` can't intercept the import in this package's module format —
  report the loader issue; do not refactor production code for testability here
  (that seam is plan 96's business).

## Maintenance notes

- Plan 96 must keep these tests green while swapping the context source — they
  define the adapter contract.
