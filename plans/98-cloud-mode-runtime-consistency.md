# Plan 98: Investigate — client/server cloud-mode disagreement on prebuilt bundles

> **Executor instructions**: INVESTIGATE plan. Deliverable is a decision +
> minimal guard, not a refactor. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/cloud/cloud-mode.ts apps/dashboard/vite.config.ts`

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: MED if the fix touches every cloud-vs-OSS UI branch (avoid; guard instead)
- **Depends on**: none
- **Category**: business-logic / investigate
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2515

## Why this matters

`isCloudModeClient()` reads only the **build-time** inlined
`VITE_CLOUD_MODE`; `isCloudModeServer()` prefers **runtime** `CHM_CLOUD_MODE` /
`CHM_DEPLOYMENT_MODE`. A prebuilt OSS bundle (e.g. the published Docker image)
started with `CHM_DEPLOYMENT_MODE=cloud` therefore splits the product: the
server enforces cloud behaviour (demo-host guard, private-host blocking) while
the client renders OSS UI (no demo badges, no demo hiding, no welcome flow).
The docs present the deployment mode as "just set one var", which makes this
an easy operator footgun. (The reverse direction is safe: fail-closed means a
cloud-built bundle without the runtime var degrades to OSS on both halves.)

## Current state

`apps/dashboard/src/lib/cloud/cloud-mode.ts`:

```ts
export function isCloudModeClient(): boolean {
  return parseCloudMode(import.meta.env.VITE_CLOUD_MODE)   // build-time only
}
export function isCloudModeServer(runtimeEnv?): boolean {
  const explicit = source.CHM_CLOUD_MODE ?? import.meta.env.VITE_CLOUD_MODE
  if (explicit !== undefined && explicit !== '') return parseCloudMode(explicit)
  return parseDeploymentMode(source.CHM_DEPLOYMENT_MODE ?? ...) === 'cloud'
}
```

`vite.config.ts` derives/inlines `VITE_CLOUD_MODE` from `CHM_*` at build time
(CLIENT_ENV). Consumers of `isCloudModeClient`: grep
`isCloudModeClient|cloudMode` in `lib/swr/use-merged-hosts.ts`,
`components/host/*`, `first-run-empty-state.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests | `cd apps/dashboard && bun test src/lib/cloud` | all pass |

## Scope

**In scope**: investigation writeup; ONE of the two minimal remedies below;
docs touch-up (`docs/content/` deployment-mode page + `docs/knowledge/cloud-saas-mode.md`).

**Out of scope**: making every client cloud branch runtime-aware (high blast
radius — explicitly not this plan).

## Steps

### Step 1: Determine whether runtime-only cloud enablement is a supported path
Evidence to gather: does the published Docker image / Helm chart documentation
anywhere suggest `CHM_DEPLOYMENT_MODE=cloud` on a prebuilt image? (`rg -n
"CHM_DEPLOYMENT_MODE|CHM_CLOUD_MODE" docs/ deploy/ docker-compose.yml
apps/dashboard/.env.example`). Is cloud mode meaningful for self-hosters at
all, or is dash.chmonitor.dev (which builds with `CHM_BUILD_ENV=production`)
the only real cloud deployment?
**Verify**: a written answer with citations.

### Step 2: Apply the minimal remedy matching the answer
- If cloud is effectively "our SaaS only": add a **server-side boot warning +
  health surface**: when `isCloudModeServer() !== parseCloudMode(import.meta.env.VITE_CLOUD_MODE)`,
  log a prominent warning ("cloud mode requires a cloud BUILD — set
  CHM_BUILD_ENV/VITE derivation; runtime flag alone splits client/server") and
  expose the mismatch in `/api/healthz` details. Document in the deployment
  docs that cloud mode is build-time.
- If runtime-only enablement should WORK: surface the server's resolved
  cloud-mode to the client at runtime (e.g. in the existing config/bootstrap
  payload the client already fetches — find it via `rg -n "deployment|config"
  apps/dashboard/src/routes/api` — and have `isCloudModeClient()` prefer that
  value with the build constant as fallback). This is the larger change; only
  take it if Step 1 shows it's a real supported path.
**Verify**: tests in `src/lib/cloud` cover the mismatch detection (or the new
client resolution); build green.

## Done criteria

- [ ] Written determination with evidence in the PR
- [ ] Mismatch is either impossible, detected-and-warned, or fixed
- [ ] Docs updated to state the contract; `plans/README.md` updated

## STOP conditions

- Step 1 evidence is contradictory (docs suggest runtime-only cloud AND the
  client architecture can't support it without the big refactor) — report the
  contradiction; the maintainer must pick.

## Maintenance notes

- Whichever contract is chosen, `docs/knowledge/cloud-saas-mode.md` is the
  source of truth — update it and bump its date (standing project instruction).
