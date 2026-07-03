# 55 — Self-hosted local config override (queries.d)

## Goal
At startup, scan `CHM_CONFIG_DIRECTORY` (default `/etc/chmonitor/queries.d`), validate each `.yaml`, and merge into the catalog under a `local` namespace. Invalid files are skipped with a clear log; the app still boots on defaults.

## Current reality (audited)
There is no local override layer: new queries require editing compiled TS (`apps/dashboard/src/lib/query-config/`). Self-hosters can't customize monitoring without forking. The declarative loader (plan 53, MERGED) makes YAML configs loadable; this plan adds a filesystem source.

## Implement now (depth F)
- New `apps/dashboard/src/lib/query-config/declarative/local-loader.ts`:
  - `loadLocalConfigs(dir)` — read `*.yaml` from `dir` (Node fs; guard for Workers where fs is unavailable — no-op with a debug log), validate each with the declarative schema, return `{ loaded, skipped: [{file, error}] }`.
- Wire into `getQueryConfigByName()` / catalog assembly so local configs merge when `CHM_CONFIG_SOURCE=declarative` (or always-merge in self-host mode `(verify)`).
- Env `CHM_CONFIG_DIRECTORY` (default `/etc/chmonitor/queries.d`); set it in the Docker entrypoint and document a K8s ConfigMap mount example in `deploy/`.
- Tests: a temp dir with one valid + one invalid YAML → valid appears in lookup, invalid is skipped (not thrown), booting still works with an empty/missing dir.

## STOP conditions & drift check
- STOP if running under Workers (no local fs) — the loader must no-op gracefully, not throw.
- STOP if plan 53's declarative path isn't merged — land 53 first. (It IS merged.)
- Drift: confirm the catalog assembly seam and the declarative schema export.

## Done criteria
- YAML files in the mounted dir appear in the UI without a rebuild.
- Invalid files are skipped + logged; missing dir boots cleanly; Workers path no-ops.
- Docker entrypoint sets the default dir; K8s mount example documented.
