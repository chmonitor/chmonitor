# Plan 88: Distinguish transient probe errors from missing optional tables (+ dispose cache intervals)

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- packages/clickhouse-client/src apps/dashboard/src/lib/cache`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2505

## Why this matters

When probing whether an optional system table exists (`system.backup_log`,
`system.error_log`, `system.zookeeper`, …), ANY probe failure — network blip,
timeout, auth — is reported as `false`, i.e. "table missing". The page then
shows a misleading "table does not exist / requires configuration" message
instead of an error/retry state. Bundled: the query-cache singletons orphan a
running 60s `setInterval` when reset (the `dispose()` written for this is dead
code).

## Current state

`packages/clickhouse-client/src/table-existence-cache.ts` (~lines 98-108):

```ts
    return exists
  } catch (err) {
    error(`Error checking table ${database}.${table}:`, err)
    return false          // ← transient error === "missing"
  }
```

(Note: the catch skips `cache.set`, so the wrong answer isn't cached — blast
radius is per-request UX.) Consumer:
`packages/clickhouse-client/src/table-validator.ts` (~lines 116-133) maps
`false` → missing → `shouldProceed: false`. Siblings with the same
`catch { return false }`: `packages/clickhouse-client/src/clickhouse-version.ts`
(~lines 230-233 `checkTableExists`, ~258-260 `checkTableHasData`).

Cache leak: `apps/dashboard/src/lib/cache/index.ts:27-33` —
`resetQueryCacheInstance` / `resetMemoryCacheInstance` null the singleton
without calling `dispose()`; `adapters/memory-cache.ts` starts a `setInterval`
in its constructor and defines `dispose()` to clear it (~lines 14-22, 66-72).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Package tests | `cd packages/clickhouse-client && bun test` (or `pnpm test` — read its package.json) | all pass |
| App tests | `cd apps/dashboard && bun test src/lib/cache` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `table-existence-cache.ts` (tri-state result),
`table-validator.ts` (surface transient errors distinctly),
`clickhouse-version.ts` (same catch fix), `apps/dashboard/src/lib/cache/index.ts`
(dispose before null), the UI message mapping in `lib/error-utils.ts` (grep the
"does not exist" message construction in the dashboard app to find where the
validator result becomes user copy), tests.

**Out of scope**: cache TTLs/architecture; retry logic (surfacing the error is
enough — the next poll retries naturally).

## Git workflow

- Branch: `advisor/88-optional-table-probe-transient-errors`
- Commit: `fix(clickhouse-client): report probe failures as errors, not missing tables`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Tri-state the probe
Change `checkTableExists` to return `true | false | 'unknown'` (or
`{ exists: boolean } | { error: Error }` — pick whichever keeps the FEWEST
call-site changes; enumerate callers first with
`rg -n "checkTableExists|checkTableHasData" packages apps/dashboard/src`).
Catch → the error/unknown variant. Never cache the unknown result.
**Verify**: package tests compile + pass.

### Step 2: Validator surfaces the distinction
`validateTableExistence`: unknown → `shouldProceed: false` with a
`reason: 'probe_failed'` (vs `'table_missing'`), so `lib/error-utils.ts` (or
whichever layer builds the user message) can say "couldn't verify table
availability (connection issue)" instead of "table does not exist".
**Verify**: unit tests for both reasons.

### Step 3: Same fix in clickhouse-version.ts
Apply the same tri-state/propagation to its `checkTableExists` /
`checkTableHasData` catch blocks.
**Verify**: package tests pass.

### Step 4: Dispose on reset
In `apps/dashboard/src/lib/cache/index.ts`, call `instance?.dispose?.()` before
nulling in both reset functions.
**Verify**: `bun test src/lib/cache` (add a test: reset calls dispose — spy on
the adapter); the existing consumer test
`src/lib/ch-cloud/billing-sync.test.ts` still passes.

## Done criteria

- [ ] Probe failure → distinct reason, different user-facing copy than missing table
- [ ] No `catch { return false }` on existence probes (grep the three files)
- [ ] Reset disposes intervals (tested)
- [ ] Package + app tests, build green; `plans/README.md` updated

## STOP conditions

- More than ~10 call sites depend on the boolean return — the tri-state ripple
  is bigger than scoped; report the caller list.
- `error-utils.ts` message construction is shared with non-optional-table
  errors in a way that a new reason string breaks — report.

## Maintenance notes

- The optional-table UX ("requires configuration" guidance) stays for genuine
  `false`; only the error path changes copy. Reviewer: check both messages
  render (force each in a story/dev page if available).
