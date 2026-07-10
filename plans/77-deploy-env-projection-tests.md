# Plan 77: Test the deploy-time env projection that sets cloud-vs-OSS posture

> **Executor instructions**: Test-only plan — no production changes. Follow
> steps, verify each. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/scripts/deploy-defaults.ts apps/dashboard/scripts/patch-wrangler-env.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2494

## Why this matters

`modeDefaultVars()` and `patch-wrangler-env.ts` decide, at deploy time, whether
production runs as public read-only Cloud or as OSS. The file's own comment
warns a mismatch "would silently drop the cloud public-read posture → anon
401". The runtime resolver (`lib/config/deployment-mode.ts`) is tested; this
deploy-side projection has zero tests and lives in a churn-heavy area
(`vite.config.ts` env derivation ~20 commits/90d).

## Current state

`apps/dashboard/scripts/deploy-defaults.ts:88-100`:

```ts
export function modeDefaultVars(mode: DeploymentMode): Record<string, string> {
  const d = MODE_DEFAULTS[mode]
  const vars: Record<string, string> = {}
  if (d.cloudMode) vars.CHM_CLOUD_MODE = 'true'
  if (d.authProvider !== 'none') vars.CHM_AUTH_PROVIDER = d.authProvider
  if (d.clerkPublicRead) vars.CHM_CLERK_PUBLIC_READ = 'true'
  if (d.userConnectionsDb) vars.CHM_FEATURE_USER_CONNECTIONS_DB = 'true'
  if (d.conversationDb) vars.CHM_FEATURE_CONVERSATION_DB = 'true'
  return vars
}
```

`apps/dashboard/scripts/patch-wrangler-env.ts` (~179 lines): `parseDotenv`
(dotenv parsing + overlay precedence, `.env.production` + `.env.preview`), and
the patch step that injects `[vars]` into `dist/server/wrangler.json`.
No test files exist under `apps/dashboard/scripts/`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Run new tests | `cd apps/dashboard && bun test scripts/` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope** (create): `apps/dashboard/scripts/deploy-defaults.test.ts`,
`apps/dashboard/scripts/patch-wrangler-env.test.ts` (+ small fixture strings
inline; a fixture `wrangler.json` object literal in the test).

**Out of scope**: the scripts themselves; `vite.config.ts`; CI workflow files.
If a function isn't exported, see STOP conditions.

## Git workflow

- Branch: `advisor/77-deploy-env-projection-tests`
- Commit: `test(deploy): cover modeDefaultVars and wrangler env patching`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: `deploy-defaults.test.ts`
- `modeDefaultVars('oss')` → `{}` (no cloud vars — fail-closed invariant)
- `modeDefaultVars('cloud')` → exactly the five cloud vars above with expected values
- Assert the projection matches the runtime resolver: for each mode, the vars,
  when fed back through `resolveConfig`/`modeDefaults` from
  `src/lib/config/deployment-mode.ts`, resolve to the same posture (anti-drift).
**Verify**: `bun test scripts/deploy-defaults.test.ts` → pass.

### Step 2: `patch-wrangler-env.test.ts`
- `parseDotenv`: basic KEY=VALUE, quoted values, comments/blank lines ignored,
  later file overlays earlier (preview over production precedence — read the
  script to confirm the direction and encode it).
- Patch step: given a fixture wrangler config object and a vars map, the output
  JSON contains the vars and preserves unrelated keys.
**Verify**: `bun test scripts/patch-wrangler-env.test.ts` → pass.

## Done criteria

- [ ] Both test files exist; `bun test scripts/` all pass
- [ ] `git diff` shows only test files (plus optional `export` keywords — see STOP)
- [ ] `plans/README.md` updated

## STOP conditions

- Needed functions aren't exported AND exporting them changes script execution
  semantics (e.g. top-level side effects on import) — report with the minimal
  refactor proposal (usually an `if (import.meta.main)` guard) instead of doing it.
- The bun test runner can't import from `scripts/` due to tsconfig scoping —
  report the config error, don't move the scripts.

## Maintenance notes

- Whenever a new `CHM_*` flag joins `MODE_DEFAULTS`, the exact-equality test in
  Step 1 will fail — that is intended; update both together.
