# Plan 118: Accept cron-trigger auth via header only (drop `?secret=`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/routes/api/cron/ docs/content/ | head`
> On mismatch, re-read live files.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW–MED (scheduler configs must move to headers — needs a docs note; CF Cron triggers can send headers)
- **Depends on**: none
- **Category**: security / dx
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3313

## Why this matters

All four cron routes (`health-sweep.ts:73`, `retention-prune.ts:70`,
`monthly-report.ts:44`, `weekly-report.ts:64`) accept the shared cron secret as
`?secret=` AND compare it constant-time, but a URL query parameter lands in
Cloudflare/proxy access logs and browser history if ever invoked manually. The
destructive retention-prune trigger therefore has a persistent-log exposure
channel; rotation is the only remediation once logged. The header channel
(`Authorization: Bearer`) doesn't log.

## Current state

Each route file contains the same pattern:

```ts
const querySecret = url.searchParams.get('secret')
```

…combined with a header check nearby (read one file fully to mirror exactly;
keep BOTH comparisons during a transition window per Step 1).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Cron tests | `cd apps/dashboard && bun test src/routes/api/cron --isolate` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- The four `apps/dashboard/src/routes/api/cron/*.ts` route files
- Their tests (`src/routes/api/cron/__tests__/`)
- Docs: whichever page documents cron setup (`rg -l "secret" docs/content/guide --glob '*.mdx' | grep -i cron` or similar; likely ops/scheduled pages)

**Out of scope**:
- Cloudflare-side scheduler configuration (operator action; docs note covers)
- Changing the secret value or its env var name

## Git workflow

- Branch: `advisor/118-cron-header-auth`
- Commit: `fix(cron): accept trigger secret via Authorization header only`

## Steps

1. In each route: keep reading `Authorization: Bearer <secret>`; REMOVE the
   `searchParams.get('secret')` fallback. If any internal caller (scripts/,
   cloud-hooks probes hitting these endpoints) sends ?secret= today, migrate
   that call site IN THE SAME CHANGE (grep first:
   `rg -n "secret=" scripts apps/cloud-hooks/src | grep -v test`).
2. Update/extend route tests: header auth accepted; query-param auth now 401.
3. Docs: add one line to the cron docs page — configure your scheduler to send
   the secret as `Authorization: Bearer`; `?secret=` no longer accepted since
   vNEXT. Mention rotation if any operator ever used the query form.

## Done criteria

- [ ] `rg -n "searchParams.get\\('secret'\\)" apps/dashboard/src/routes/api/cron/` → no matches
- [ ] Tests prove 401 on query-param auth, 200 on header auth
- [ ] Docs updated; suites green

## STOP conditions

- An external caller you cannot change (e.g., an external monitor service documented in docs) relies on ?secret= → STOP and report instead of breaking it silently.

## Maintenance notes

- Operators who may have used the query form should rotate CHM_CRON_SECRET —
  say so in the PR body.
- Consider logging a warning when a request arrives with a legacy ?secret=
  for one release before hard-removal IF Step 1 finds such callers; otherwise
  clean cut is fine.
