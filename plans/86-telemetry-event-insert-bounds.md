# Plan 86: Bound the unauthenticated telemetry /v1/event insert

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/telemetry/src`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (analytics-only table; counts stay directionally correct)
- **Depends on**: none
- **Category**: security (abuse/write amplification)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2503

## Why this matters

The telemetry worker's `POST /v1/event` is unauthenticated by design (opt-in
product telemetry) but does a plain `INSERT` per request with **no dedup and no
rate limit** — an anonymous client can append unbounded rows to the `events` D1
table (storage growth + D1 write cost). The sibling `/v1/ping` endpoint already
self-bounds with `INSERT OR IGNORE` into `ping_daily` keyed on
`(day, instance_hash)`. Give `events` the same shape.

## Current state

`apps/telemetry/src/index.ts` (~lines 778-802): validates `event` against an
`EVENTS` allowlist, normalizes props, then:

```ts
const day = new Date().toISOString().slice(0, 10)
ctx.waitUntil(
  env.CHM_TELEMETRY_DB.prepare(
    'INSERT INTO events (day, event, deploy_target, ch_version, ch_flavor) VALUES (?, ?, ?, ?, ?)'
  ).bind(day, event, deployTarget, chVersion || null, chFlavor || null).run()...
```

`/v1/ping` (~lines 750-775) uses `INSERT OR IGNORE INTO ping_daily`. Only body
guard is `MAX_BODY_BYTES = 2048`. Check the D1 schema/migrations in
`apps/telemetry/` for the `events` table definition and how `instance_hash` is
derived for pings.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/telemetry && bun test` (check package.json for the script) | all pass |
| Typecheck | `cd apps/telemetry && pnpm run build` (or check script) | exit 0 |

## Scope

**In scope**: `apps/telemetry/src/index.ts` `/v1/event` handler, a D1 migration
adding a uniqueness key if needed, tests.

**Out of scope**: `/v1/ping`, `/v1/summary`, dashboards consuming the data;
client-side telemetry emitters.

## Git workflow

- Branch: `advisor/86-telemetry-event-insert-bounds`
- Commit: `fix(telemetry): dedupe per-day event inserts`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Choose the dedup key
Preferred: same posture as pings — one row per
`(day, event, instance_hash, deploy_target)` via `INSERT OR IGNORE` + a unique
index (migration). If `/v1/event` requests don't carry an instance hash today,
check what identifying prop the client sends (read the event-emitter in
`apps/dashboard` — grep `v1/event`); if none, dedup on
`(day, event, deploy_target, ch_version, ch_flavor)` — coarser but bounded.
**Verify**: written decision in the PR description; migration file added.

### Step 2: Implement + test
Switch the INSERT to `INSERT OR IGNORE` against the unique index. Tests: same
payload twice on the same day → one row; different day/event → two rows.
Follow the existing telemetry test patterns (check `apps/telemetry/src/*.test.ts`).
**Verify**: `bun test` all pass; typecheck green.

## Done criteria

- [ ] Repeated identical events insert at most one row per day-key
- [ ] Migration + unique index committed; tests green
- [ ] `plans/README.md` updated

## STOP conditions

- The `events` table is consumed by a funnel that needs true per-occurrence
  counts (check `/v1/summary` queries and any PostHog cross-wiring) — dedup
  would break it; report and propose the rate-limit alternative instead.

## Maintenance notes

- If per-occurrence counting is ever needed, replace dedup with a counter
  column (`count = count + 1` upsert) — still bounded.
