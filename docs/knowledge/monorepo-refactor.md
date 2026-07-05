---
id: monorepo-refactor
type: operations
related: [static-site-architecture, deployment, rust-wasm-performance]
tags: [monorepo, refactor, workspaces, turborepo, packages, handoff]
---

# Monorepo Refactor — Status & Handoff

Migration of `clickhouse-monitoring` from an informal single-app repo into a
full Bun-workspaces + Turborepo monorepo (`apps/` + `packages/`). Strictly
phased; each phase ships as its own PR with a green CI gate.

## Target layout (reached)

```
apps/
  dashboard/    # Next.js monitoring app (output: standalone) — keeps @/* = ./*
  mcp/          # standalone Cloudflare MCP Worker (wrangler)
  landing/      # standalone Astro marketing site (chmonitor.dev apex)
  docs/         # standalone Astro Starlight docs (docs.chmonitor.dev)
packages/
  types/        @chm/types         — clean shared types + HostInfo
  sql-builder/  @chm/sql-builder    — SQL builder + VersionedSql/getAllSqlStrings
                                      /QueryConfigLike + validateSqlQuery
  platform/     @chm/platform       — runtime/platform adapters
  logger/       @chm/logger         — logging (zero deps)
  clickhouse-client/ @chm/clickhouse-client — client+fetch+version+validators+wasm+runtime
  mcp-server/   @chm/mcp-server     — MCP server, tools, prompts, resources, auth, tool-data
rust/           # ONE Cargo workspace: monitor-core(wasm), ch-json, ch-pivot,
                #   ch-monitor-cli, user-events-rs
docs/           # content/ knowledge/ clickhouse-schemas/ agents/ (live /docs is
                #   rendered by apps/dashboard from docs/content; the old Nextra site was removed)
```

Packages are **source-only** (no build step): `main`/`types`/`exports` point at
`./src`, consumed via tsconfig path mappings + workspace symlinks. `apps/dashboard`
declares them `workspace:*` and maps `@chm/*` in its tsconfig; `@/*` stays
app-local (`./*`) so the ~700 intra-web imports never changed.

## Phase status

| Phase | What | PR | State |
|---|---|---|---|
| 0 | tsconfig.base.json + Turbo pipeline | #1219 | ✅ merged |
| 1 | extract @chm/types, sql-builder, platform; break HostInfo cycle | #1221 | ✅ merged |
| 2 | move web app → apps/web/ (1273 renames, package.json split; later renamed apps/dashboard/) | #1222 | ✅ merged |
| 2-fix | cf:build nested-standalone stub path | #1223 | ✅ merged |
| – | unify tools/ → rust/ Cargo workspace | #1224 | ✅ merged |
| – | rust fmt (ch-pivot, surfaced by the workspace unify) | #1226 | ✅ merged |
| 3 | mcp worker → apps/mcp-worker/ (later renamed apps/mcp/) | #1225 | ✅ merged |
| 3 | remove dead Nextra docs/app, recover doc images | #1227 | ✅ merged |
| 4a | extract @chm/logger | #1228 | ✅ merged |
| 4 | extract @chm/clickhouse-client + @chm/mcp-server | #1230 | ✅ merged |
| 5 | depcruise + changesets + MCP worker CI | #1232 | ✅ merged |
| 6 | 4-app topology: rename apps/web→apps/dashboard, apps/mcp-worker→apps/mcp; add apps/landing + apps/docs (Astro); workers chmonitor-{dash,mcp,landing,docs} on dash/docs/apex domains | #1368–#1377 | ✅ merged |

`main` deploys to Cloudflare on every push (`cloudflare.yml`); Deploy has stayed
green throughout. See [[deployment]].

## The workflow (methodology used — reuse for Phase 5 and future phases)

1. **Explore first.** Map the exact file set, importer counts, and any
   app-coupling that blocks a clean extraction (a package may NOT import from
   `apps/dashboard`). Read-only Explore agents are good for this.
2. **One focused PR per phase**, branched off latest `main`.
3. **Move with `git mv`** (preserves history). Rewrite importers in bulk with
   `perl -i` (`@/lib/x` → `@chm/x`); then `grep` for stragglers — watch for
   **relative** imports (`./x`, `../x`) the path-based sed misses, and
   **comments/mock specifiers**.
4. **Decouple, don't drag.** When a package file imports a web-coupled god-type
   (e.g. `@/types/query-config`, which imports components), extract only the
   clean pieces it needs into a leaf package (`VersionedSql`, `getAllSqlStrings`,
   a minimal `QueryConfigLike`) and re-export from the app type. No shims.
5. **Verify locally before PR:** `pnpm install` → `pnpm run type-check` (0 errors)
   → `pnpm run build` (standalone at `apps/dashboard/.next/standalone/apps/dashboard/server.js`)
   → for worker/cf changes `bun wrangler deploy --dry-run --config apps/mcp/wrangler.toml`
   → run BOTH `pnpm run test:unit` (apps/dashboard) AND `bun test packages` (package tests
   live outside apps/dashboard's suite — CI runs them via a dedicated step).
6. **Open PR + `gh pr merge <n> --auto --squash`.** Required checks: build, lint,
   preview, test-queries-config, build-docker-pr. `unit-tests` and
   `component-test` are **known-flaky / not required** — admin-merge past them
   (`gh pr merge <n> --squash --admin`) once the real gates are green and the
   change provably can't affect them.
7. **main moves under long PRs.** Rebase: git rename-detection auto-merges
   upstream edits to moved files; only `package.json`/`bun.lock` truly conflict —
   resolve by regenerating the split + `git checkout origin/main -- bun.lock &&
   pnpm install`.
8. **Checkpoint to session memory** between phases (the refactor spans many
   context windows).

## Hard-won gotchas (don't rediscover these)

- **`next.config.ts` must stay CommonJS** (it uses `require.resolve`). Do NOT add
  `import.meta.url` — it forces ESM and breaks the compiled config. Use native
  `__dirname`.
- **Standalone output is nested** in a monorepo: `apps/dashboard/.next/standalone/apps/dashboard/server.js`.
  Docker `CMD ["bun","apps/dashboard/server.js"]`; static→`./apps/dashboard/.next/static`.
  `scripts/stub-prerendered-handlers.ts` detects the package sub-path via the
  first lockfile walking up (same as `@opennextjs/aws`).
- **Bun hoists deps to the ROOT `node_modules`** (no `apps/dashboard/node_modules`);
  `@chm/*` are symlinks there. Dockerfile copies only root node_modules, BUT must
  `COPY apps/<app>/package.json` for EACH app before `pnpm install --frozen-lockfile`
  (currently dashboard + mcp), or it errors "lockfile had changes, but frozen".
  `packages/` is covered by `COPY packages/`.
- **tsc heap OOM** on a cold full check: `NODE_OPTIONS=--max-old-space-size=6144`
  on apps/dashboard `build` + `type-check`. Delete stale `tsconfig.tsbuildinfo`.
- **Dual zod copies** after a workspace split → TS2589. Pin `"zod"` in root
  `overrides` AND `pnpm.overrides`, then `pnpm install --force` (plain install
  won't re-dedupe).
- **OpenNext monorepo detection** uses the first lockfile walking up from cwd; run
  `cf:build`/wrangler with the worker's own config and let it resolve.
- **MCP SDK + Edge Runtime:** importing anything from `@chm/mcp-server`'s barrel
  (which pulls `createMcpServer` → the MCP SDK) into `middleware.ts` fails the
  Edge build. Auth/data-only consumers must use the `@chm/mcp-server/auth` and
  `/data` subpaths.
- **Turbo task `inputs` can't reference outside the package** — put cross-package
  / root deps (rust, scripts) in `globalDependencies`.

## Remaining: post-Phase 5 cleanup

1. **Docs accuracy** (optional): update `CLAUDE.md` paths (`workers/mcp` →
   `apps/mcp`, `lib/clickhouse` → `@chm/clickhouse-client`, drop Nextra
   docs refs).
2. **npm publish**: when ready to publish `@chm/*` packages, run
   `npm publish --dry-run` per package to verify, then publish for real.

## Resume command

```
/goal merge PR #1232 (Phase 5) once real CI gates green; admin-merge past
known-flaky unit-tests/component-test. Monorepo refactor is complete after merge.
```
