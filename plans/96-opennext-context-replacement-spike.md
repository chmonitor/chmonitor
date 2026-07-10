# Plan 96: Spike — replace @opennextjs/cloudflare's getCloudflareContext with native binding access

> **Executor instructions**: This is a SPIKE plan: investigate, prototype in a
> branch, and produce a written recommendation + working prototype. Do NOT
> merge-ready-ify beyond the prototype unless every verification passes
> cleanly. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- packages/platform`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches how every CF binding resolves)
- **Depends on**: plans/95 (adapter contract tests must exist first)
- **Category**: migration
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2513

## Why this matters

The app migrated from Next.js/OpenNext to TanStack Start + native Workers, but
`packages/platform` still depends on `@opennextjs/cloudflare@1.19.11` for ONE
function — `getCloudflareContext` — to reach CF bindings. It is the transitive
source of a moderate `postcss` advisory (GHSA-qx2v-qp2m-jg93) and a
heavyweight Next.js-era dependency kept alive for functionality
`@cloudflare/vite-plugin` provides natively (the `cloudflare:workers` virtual
module exposes `env`).

## Current state

- `packages/platform/package.json:12` — `"@opennextjs/cloudflare": "1.19.11"`.
- `packages/platform/src/adapters/cloudflare.ts:11` — the only import site
  (file header: "the ONLY file that should import from `@opennextjs/cloudflare`").
- Consumers of `@chm/platform` bindings: dashboard `platform-native.ts`,
  insights stores, connection-sessions, billing subscription store, health
  stores (grep `getPlatformBindings` in `apps/dashboard/src`).
- Runtimes that must keep working: CF Worker (cloud + self-host CF), Node
  (Docker/K8s via the node build), tests (memory adapter).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Contract tests | `cd packages/platform && bun test` | pass (from plan 95) |
| Dashboard build (CF) | `cd apps/dashboard && pnpm run build` | exit 0 |
| Dry-run deploy | `cd apps/dashboard && pnpm exec wrangler deploy --minify --dry-run` | exit 0 |
| Node build | `cd apps/dashboard && bun scripts/build-node-ci.ts` (verify script name in package.json) | exit 0 |
| Audit | `cd apps/dashboard && pnpm audit --prod` | postcss advisory gone |

## Scope

**In scope**: `packages/platform/src/adapters/cloudflare.ts` (context source),
`packages/platform/package.json` (drop the dep), a written
`docs/knowledge/`-style summary in the PR description.

**Out of scope**: adapter public API (plan 95's tests pin it); any consumer
changes (the point is zero consumer diff); D1 schema.

## Git workflow

- Branch: `advisor/96-opennext-context-replacement`
- Commit: `refactor(platform): native Workers env access, drop @opennextjs/cloudflare`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Establish how the Worker gets `env` today
Read how the dashboard's server entry threads Cloudflare `env`
(`src/start.ts`, and any `cloudflare:workers` imports —
`rg -n "cloudflare:workers|getPlatformBindings|setPlatformBindings" apps/dashboard/src packages/platform/src`).
Two candidate designs:
a) import `{ env }` from `cloudflare:workers` inside the adapter (build-time
   virtual module; needs the package to be built/aliased for non-CF runtimes);
b) explicit injection: the app calls a `setCloudflareEnv(env)` at request/boot
   time and the adapter reads it (no virtual-module coupling in the package).
**Verify**: a one-paragraph recommendation with the tradeoff written down.

### Step 2: Prototype the chosen design
Implement behind the SAME adapter API. Keep plan 95's tests green (update the
mock target from `@opennextjs/cloudflare` to the new seam).
**Verify**: package tests pass; dashboard CF build + wrangler dry-run green;
node build green.

### Step 3: Remove the dependency + audit
Drop `@opennextjs/cloudflare` from packages/platform; `pnpm install`;
`pnpm audit --prod` in apps/dashboard.
**Verify**: `rg -rn "@opennextjs" apps packages` → no source references;
audit no longer lists the postcss advisory via the opennext path.

### Step 4 (gate): Runtime smoke
If a dev CF environment is available: `pnpm run dev` in apps/dashboard and
exercise one D1-backed flow (e.g. list user connections signed-in, or any
insights read). If no environment: mark the plan BLOCKED-ON-VERIFICATION in
plans/README.md rather than DONE.

## Done criteria

- [ ] No `@opennextjs/cloudflare` anywhere; audit clean of its advisories
- [ ] Plan 95 contract tests pass unmodified in behaviour (mock seam may move)
- [ ] CF build, dry-run, node build all green
- [ ] Runtime smoke done or plan marked BLOCKED-ON-VERIFICATION
- [ ] `plans/README.md` updated

## STOP conditions

- `cloudflare:workers` env is unavailable at the point the adapter needs it
  (e.g. module-init vs request-time ordering) AND injection (design b) would
  require touching >5 consumer files — report the coupling map.
- Docker/Node runtime regressions (bindings resolve differently) — report.

## Maintenance notes

- After this, `packages/platform` is framework-agnostic; the file-header rule
  ("only this file imports the context source") still applies to the new seam.
