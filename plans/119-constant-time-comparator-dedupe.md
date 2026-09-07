# Plan 119: Consolidate the four constant-time string comparators into one tested helper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/lib/auth/providers/constant-time.ts apps/dashboard/src/routes/api/v1/auth/api-key.ts packages/mcp-server/src/auth/api-key.ts apps/cloud-hooks/src/clerk-webhook.ts`
> On mismatch, re-read live files.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW–MED (touches auth comparisons; behavior must be provably identical)
- **Depends on**: plan 115 (its tests pin api-key route behavior first — soft, can proceed in parallel if careful)
- **Category**: security / tech-debt (extends still-open plan 78's goal to new files)
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3314

## Why this matters

Plan 78 ("one comparator so they can't drift") is still open and meanwhile the
copies have MULTIPLIED: beside the shared `apps/dashboard/src/lib/auth/providers/constant-time.ts`,
three new independent implementations guard money/auth paths —
`routes/api/v1/auth/api-key.ts:31` (`timingSafeEqualString`),
`packages/mcp-server/src/auth/api-key.ts:60` (`constantTimeEqual`, Uint8Array),
`apps/cloud-hooks/src/clerk-webhook.ts:82` (`safeEqual`). None of the copies
has direct tests. One future regression (e.g., an early-exit compare) is
invisible in three places at once.

## Current state

All four implementations are length-safe constant-time compares over
UTF-8 strings/bytes. The package boundary matters: `@chm/mcp-server` cannot
import from apps (dependency-cruiser `no-packages-to-apps`), and cloud-hooks is
a separate worker with its own lockfile but DOES import `@chm/*` workspace
packages already.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Package tests | `bun test packages --isolate` | pass |
| Cloud-hooks | `cd apps/cloud-hooks && bun test src/clerk-webhook.test.ts --isolate` | pass |
| Dashboard auth tests | `cd apps/dashboard && bun test src/routes/api/v1/auth src/lib/auth --isolate` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- NEW shared helper: `packages/types/src/...` or a better-fitting existing
  package — decide by reading where `constant-time.ts` lives today and what
  all three consumers can import without new cycles (candidate: put the
  canonical implementation in a tiny module under `packages/logger`? No —
  prefer `packages/types` only if it has runtime exports; otherwise create
  `packages/auth-utils` minimal package). Justify choice in NOTES.
  **Simplest correct option: keep `lib/auth/providers/constant-time.ts` as
  canonical for dashboard; add ONE copy in `packages/mcp-server/src/auth/timing.ts`;
  cloud-hooks imports from `@chm/mcp-server/auth` (it already depends on
  @chm packages).** Choose this unless blocked.
- Delete inline copies in the three sites; point them at the shared export.
- Tests: golden vectors for the shared comparator(s).

**Out of scope**:
- Svix/HMAC logic itself (only the final compare call swaps)
- Any behavioral change

## Git workflow

- Branch: `advisor/119-comparator-dedupe`
- Commit: `refactor(auth): one tested constant-time comparator across surfaces`

## Steps

1. Add `timingSafeEqualString(a,b)` to `packages/mcp-server/src/auth/timing.ts`
   (port the most complete existing implementation), export from the auth
   index. Golden-vector tests: equal strings true; different lengths false;
   single-char difference false; empty strings true; unicode pairs.
2. Swap `api-key.ts` route + `clerk-webhook.ts` to import it (cloud-hooks adds
   `@chm/mcp-server` dep if absent). Delete local copies. Dashboard's existing
   `constant-time.ts` may delegate or remain for its internal callers — do not
   break its tests.
3. Run battery.

## Done criteria

- [ ] `rg -n "function timingSafeEqualString\|function safeEqual\|function constantTimeEqual" apps packages` → only the canonical definition(s) remain
- [ ] Golden-vector tests exist and pass; all suites green

## STOP conditions

- Importing mcp-server auth from cloud-hooks creates a bundling problem (worker size gate) → instead duplicate-with-tests is acceptable fallback: keep clerk-webhook's local fn but ADD direct unit tests for it; report which path taken.

## Maintenance notes

- Closes the "spread" half of plan 78; after landing, plan 78's remaining scope
  (dashboard-side dedupe) should be re-checked and likely marked done too.
