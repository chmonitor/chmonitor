---
id: monorepo-refactor
type: decision
updated: 2026-09-30
related: [static-site-architecture, deployment, rust-wasm-performance]
tags: [monorepo, refactor, workspaces, turborepo, packages, handoff]
---

# Monorepo Refactor — Completed (2026-07-05)

> **Closed.** Every phase below shipped and merged; the last was Phase 6
> (#1368–#1377). The layout block is the state **as of today**, not the 2026-07
> state. The refactor is history — read this note for the still-live gotchas
> (the bottom section) and the migration methodology, not as a handoff.
> Framework work has since moved on again: `apps/dashboard` is TanStack Start,
> `apps/docs` is Fumadocs, and pnpm replaced Bun workspaces. Those are *not*
> this refactor's doing; they are noted inline below so nothing here reads as
> present tense.

Migration of `clickhouse-monitoring` from an informal single-app repo into a
workspaces + Turborepo monorepo (`apps/` + `packages/`). Strictly phased; each
phase shipped as its own PR with a green CI gate. All merged.

## Target layout (reached — members as of 2026-09-30)

```
apps/
  dashboard/    # TanStack Start monitoring app (was Next.js; output: standalone
                #   is superseded — no .next, no OpenNext) — keeps @/* = ./*
  docs/         # Fumadocs + TanStack Start docs site (docs.chmonitor.dev);
                #   was Astro Starlight
  landing/      # standalone Astro marketing site (chmonitor.dev apex)
  mcp/          # standalone Cloudflare MCP Worker (wrangler)
  blog/         # Astro blog (release notes)
  bug-handler/  # Cloudflare Worker
  cloud-hooks/  # Cloudflare Worker
  telemetry/    # Cloudflare Worker
packages/       # root pnpm workspace: packages/*
  types/            @chm/types
  sql-builder/      @chm/sql-builder   — SQL builder + VersionedSql/getAllSqlStrings
                                        /QueryConfigLike + validateSqlQuery
  logger/           @chm/logger        — logging (zero deps)
  clickhouse-client/ @chm/clickhouse-client — client+fetch+version+validators+wasm+runtime
  mcp-server/       @chm/mcp-server    — MCP server, tools, prompts, resources, auth, tool-data
  billing-webhook-core/ @chm/billing-webhook-core
  postgres-client/  @chm/postgres-client
  pricing/          @chm/pricing
  query-advisor-core/ @chm/query-advisor-core
  site-nav/         @chm/site-nav
  # there is NO packages/platform. @chm/platform is a tsconfig *path alias*
  #   in apps/dashboard (tsconfig.json + tsconfig.test.json) →
  #   ./src/lib/platform-native.ts, a native Cloudflare binding adapter.
  #   See [[tsr-migration]] § "OpenNext coupling for D1".
rust/           # ONE Cargo workspace (rust/Cargo.toml members): monitor-core(wasm),
                #   ch-json, ch-pivot, ch-monitor-cli, user-events-rs
docs/           # content/ knowledge/ clickhouse-schemas/ agents/ (the live
                #   /docs site is apps/docs, which builds its content collection
                #   from docs/content via apps/docs/scripts/sync-docs.mjs; the old Nextra
                #   site was removed)
```

Packages are **source-only** (no build step): `main`/`types`/`exports` point at
`./src`, consumed via tsconfig path mappings + workspace symlinks. `apps/dashboard`
declares them `workspace:*` and maps `@chm/*` in its tsconfig; `@/*` stays
app-local (`./*`) so the ~700 intra-web imports never changed.

## Phase status — every row merged; last touched 2026-07-05

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
| 6 | 4-app topology: rename apps/web→apps/dashboard, apps/mcp-worker→apps/mcp; add apps/landing + apps/docs (Astro at the time; `apps/docs` is now Fumadocs + TanStack Start); workers chmonitor-{dash,mcp,landing,docs} on dash/docs/apex domains | #1368–#1377 | ✅ merged |

`main` deploys to Cloudflare on every push (`cloudflare.yml`); Deploy has stayed
green throughout. See [[deployment]].

## The workflow (methodology used — reuse for future extractions)

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
5. **Verify locally before PR** (commands as they stand today):
   - `pnpm install` → `pnpm run type-check` (0 errors) → `pnpm run build`.
     The dashboard builds to a Cloudflare Workers bundle via
     `@cloudflare/vite-plugin`; there is no `.next/standalone/...` output any more.
   - Worker/Cloudflare dry run: `pnpm exec wrangler deploy --minify --dry-run`
     (or `cd apps/dashboard && pnpm run cf:dry-run`). **Not** `bun wrangler` —
     pnpm is the package manager; `bun` is only the test runner and the `.ts`
     script runtime.
   - Run BOTH `pnpm run test:unit` (the dashboard) AND `pnpm run test:packages`
     (`bun test packages`) — package tests live outside the dashboard's suite.
6. **Open PR, then let branch protection decide.** The **required** status
   checks on `main` are exactly **`dashboard`** (`.github/workflows/cloudflare.yml`
   job `dashboard`) and **`unit-tests`** (`.github/workflows/test.yml` job
   `unit-tests`). Do **not** admin-merge past either — `unit-tests` used to be
   waved through here and is now a hard gate, so a red one is a real signal, not
   flake. Required-ness lives in branch protection and is **not** declared in
   any workflow YAML, so read it directly:
   `gh api repos/chmonitor/chmonitor/branches/main/protection --jq '.required_status_checks.contexts'`
   → `["dashboard","unit-tests"]`. The other jobs in the tree (`e2e-test`,
   `test-queries-config`, `test-postgres-integration`, `component-test`) are
   **not** required.
7. **main moves under long PRs.** Rebase: git rename-detection auto-merges
   upstream edits to moved files; only `package.json`/`pnpm-lock.yaml` truly
   conflict — resolve by regenerating the split +
   `git checkout origin/main -- pnpm-lock.yaml && pnpm install`.
8. **Checkpoint to session memory** between phases (the refactor spans many
   context windows).

## Hard-won gotchas (still live — don't rediscover these)

Two bullets in the 2026-07 version of this list described Next.js and Bun and
are **gone** (no `next.config.ts`, no `.next/standalone`, no Bun workspaces,
no OpenNext). They were removed, not preserved, because the thing they warned
about no longer exists. The rest still hold.

- **Node build output is not `.next/standalone`.** The dashboard is TanStack
  Start: the CF target bundles straight to workerd via
  `@cloudflare/vite-plugin`, and the Docker/Node target lands at
  `.output/server/index.mjs` — which is what `Dockerfile:92` runs
  (`CMD ["node", "server/index.mjs"]`). The old
  `scripts/stub-prerendered-handlers.ts` walked up for the first lockfile to
  detect the Next.js package sub-path; it is still in `scripts/` but has no
  Next.js output to stub.
- **pnpm, not Bun, owns `node_modules` — and the dashboard is its own
  project.** The root workspace (`pnpm-workspace.yaml`) covers `apps/mcp` +
  `packages/*` only. `apps/dashboard` has its **own** `pnpm-lock.yaml` and its
  **own** `node_modules/@chm/*` symlinks into `packages/`; there is no
  hoisting to the root. `package.json` pins `packageManager: pnpm@10.18.0` and
  `preinstall: npx only-allow pnpm`, so the contract is enforced, not advisory.
  Docker therefore copies each project's own lockfile before
  `pnpm install --frozen-lockfile`.
- **tsc heap OOM** on a cold full check. Escape hatch:
  `NODE_OPTIONS=--max-old-space-size=6144` on the dashboard's `build` +
  `type-check`, and delete a stale `tsconfig.tsbuildinfo`. Neither is wired
  into a script today — set it yourself when the check dies.
- **Dual zod copies** after a workspace split → TS2589. The current tree
  dodges it with a single direct pin: `apps/dashboard/package.json` declares
  `"zod": "^4.4.3"` and every resolved copy in `apps/dashboard/pnpm-lock.yaml`
  is `zod@4.4.3`. There is no workspace-level zod override any more. If
  TS2589 returns, that pin (plus `pnpm install --force`, since a plain install
  will not re-dedupe) is the seam to move.
- **MCP SDK subpath imports.** Importing from `@chm/mcp-server`'s barrel pulls
  `createMcpServer` → the MCP SDK, which fails the Edge/worker build. Auth- and
  data-only consumers must use the `@chm/mcp-server/auth` and `/data` subpaths
  (declared in `packages/mcp-server/package.json` `exports`).
  The old note named `middleware.ts`; the equivalent file in the TanStack Start
  app is `src/start.ts`.
- **Turbo task `inputs` can't reference outside the package** — put cross-package
  / root deps (rust, scripts) in `globalDependencies`.
  (`turbo.json` `globalDependencies`: `tsconfig.base.json`, `biome.json`,
  `pnpm-lock.yaml`, `scripts/**`.)
- **Move with `git mv` and rewrite importers in bulk** — the method from
  workflow step 3 above. It worked; 1273 renames and the `@/*` → `@chm/*`
  importer sweep both went through without a per-file hand edit.

## Post-refactor cleanup — one item done, one a product decision

1. ~~**Docs accuracy**: update `CLAUDE.md` paths (`workers/mcp` → `apps/mcp`,
   `lib/clickhouse` → `@chm/clickhouse-client`, drop Nextra refs).~~
   **Done** — `CLAUDE.md` is a stub that includes `AGENTS.md`, and it contains
   none of `workers/mcp`, `nextra`, or `Nextra`.
2. **npm publish for `@chm/*`** — still open, and it is a *product* decision
   rather than a doc claim: nothing in the tree declares a publish intent for
   the workspace packages. Left here deliberately, unowned, so it is visible
   rather than silently dropped.

## Nothing to resume

The note used to end with a resume command for PR #1232 (Phase 5). #1232
merged — it is the ✅ row at the top of the phase table above, and Phase 6
(#1368–#1377) closed the refactor after it. There is no open work and no
resume command.
