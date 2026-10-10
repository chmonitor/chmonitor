# AGENTS.md

Canonical project instructions for every coding agent (Claude, Grok, Codex, Cursor).
`CLAUDE.md` is a stub that includes this file — edit **this** file only.

## Git Commit Convention

**IMPORTANT**: Every commit is authored by **duyet** with **duyetbot** as
co-author. The local git identity on agent machines is often `duyetbot`, so
set the author explicitly on every commit you create, in this repo and in
sibling repos (for example `chmonitor/launch`):
```
git commit --author="duyet <5009534+duyet@users.noreply.github.com>" ...

Co-Authored-By: duyetbot <bot@duyet.net>
```
Squash merges on GitHub already credit duyet as author; this rule matters for
any commit pushed directly.

Use semantic commit format with consistent scope for commit messages and PR titles. Keep wording simple. Never mention external design references, visual inspiration sites, or comparative platforms in commit messages, PR titles, or PR descriptions.

## Parallel subagents (default)

Split work into independent pieces and run them as **parallel subagents** by
default — one subagent per post, page, scene, package, or PR. Do it without
being asked; sequential work is the exception and needs a reason (step N
feeds step N+1, or two pieces touch the same file).

- Give each subagent a self-contained brief: goal, exact files it owns,
  constraints, and the check that proves it is done.
- Never let two subagents edit the same file. Split by file ownership.
- Shared tools need isolation: separate agent-browser sessions (for example
  `RELEASE_SHOTS_SESSION`), separate ports, separate output dirs.
- No `pnpm run build` / `bun build` inside parallel subagents (concurrent
  builds run out of memory). Build and test once after they finish.
- Subagents do not commit or push. The lead reviews, verifies, and commits.

## PR Workflow

**Always auto-babysit PRs on this project.** After opening any PR, immediately arm
auto-merge (`gh pr merge --auto --squash`) and babysit it (`/github:babysit-pr`):
watch CI, fix failures, confirm the merge and production deploy. Do NOT ask the
user whether to babysit — just do it. Known non-required checks (`e2e-test`,
`coverage-upload`) do not block auto-merge. `unit-tests` IS a required check
(required alongside `dashboard` since 2026-07-10, plan 75). `e2e-test-tsr` and
`component-test` were deleted in June 2026 (#1613, #1623) — do not wait on them
either. `coverage-upload` fails whenever Codecov's CDN is unreachable; that is
an external outage, not a repo defect (#3647), so never hold a PR for it.

**Stale bot-review gate (authorized override).** When a bot reviewer
(CodeRabbit / `coderabbitai[bot]`, Sourcery, Gemini) leaves a
`CHANGES_REQUESTED` that blocks merge, you are authorized to dismiss it and merge
**only when ALL of these hold**: every actionable point it raised is genuinely
fixed (or was stale / referenced pre-fix code), **all required CI checks are
green**, the branch is up to date with `main`, and the bot did not re-review
after you triggered it (push a new commit, then `@coderabbitai review` /
`@coderabbitai full review`, then a formal re-request — give it a few minutes).
Dismiss with
`gh api -X PUT repos/chmonitor/chmonitor/pulls/<n>/reviews/<id>/dismissals -f event=DISMISS -f message="<why each point is addressed>"`
(bot reviews use the `coderabbitai[bot]` login; there may be more than one to
dismiss). Do NOT dismiss a human reviewer's changes-requested, and never dismiss
to skip an unaddressed finding. To avoid the gate entirely, prefer
`request_changes_workflow: false` in CodeRabbit config so it only comments.

## Issue → research → PR

Every change starts as an **issue**, becomes **clear** through research, and
lands as a **PR**. Skipping a step is allowed; skipping silently is not.

1. **Issue.** One problem, one issue. State the observable symptom and the
   evidence (a log line, a `rg -n` hit, a failing check, a screenshot). No
   "improve X" or "add Y" without a symptom someone can recognise.
2. **Research — make it clear before addressing it.** Before writing any code,
   the issue must answer:
   - **Where** — the exact files/functions, named, with the line you start at.
   - **What** — the expected behaviour after the change, in one sentence a
     reviewer could disagree with.
   - **Verify** — the check that proves it. A test name, a CI check, a curl
     command with its expected output. If there is no verify path, that is the
     finding: the issue is not ready.
   - **Not already done** — searched open issues, open PRs, and `git log`.
   Write this into the issue body (or `research-<n>.md` in the desk run dir when
   the right output is a note, not a diff). Only then is it addressable.
3. **PR.** Branch `fix/<short>` or `feat/<short>`, one concern per PR, no
   drive-by renames, no drive-by formatting, no dependency bumps riding along.
   Description states the issue it closes, the verify path, and the blast
   radius. Arm auto-merge and babysit it.

**Research-only is a valid outcome.** A vague issue, a product decision, or a
finding whose right output is knowledge gets `research-<n>.md` and stops. Do not
open a weak PR to look productive, and do not guess a product decision at 02:00.

`needs-design` is a hard stop for every agent, desk included. It means a human
owes a decision; implementing it anyway is how a repo gets a rewrite nobody
asked for.

## Scheduled desk (herdr-desk plugin)

Config only: `.herdr-desk.json`. The Herdr plugin
(`herdr plugin install duyet/herdr-desk`) picks this workspace up automatically.
Do not put scheduler/spawn logic in this repo.

Eight jobs, deliberately staggered so two never start in the same minute:

| Job | Cron | Playbook | Owns |
|---|---|---|---|
| `desk:github-issues` | `0,30 * * * *` | bundled `github-issues` | triage, research, dispatch children |
| `local:babysit` | `10,40 * * * *` | `docs/herdr-desk/babysit-prs.md` | red required CI, review replies, auto-merge, worktree cleanup |
| `local:prod` | `20,50 * * * *` | `docs/herdr-desk/prod-watch.md` | live-deploy verification, agent probe, usage, revert on regression |
| `local:improve` | `17 2 * * *` | `docs/herdr-desk/improve.md` | desk health, dead code, slowdowns |
| `local:secrets` | `6 6 * * *` | `docs/herdr-desk/secrets.md` | every `secrets.*` a workflow references vs. what exists; workflows with zero successful runs |
| `local:red-jobs` | `26 7 * * *` | `docs/herdr-desk/red-jobs.md` | the CI jobs babysit must ignore; classifies each as repo defect or external fact |
| `local:stale-issues` | `34 9 * * *` | `docs/herdr-desk/stale-issues.md` | closes stale-bot / fixed / superseded / duplicate issues with a reason |
| `local:docs` | `46 3 * * *` | `docs/herdr-desk/docs-drift.md` | prose-named dead paths, dangling `related:` ids, stale notes |

The last four each close a hole where a failure is invisible *because* nothing
depends on it: a workflow nothing gates can fail forever, a red job nobody owns
decays into noise, and a queue nobody prunes becomes a graveyard. The doc/skill
class is split in two on purpose — `tests/repo/markdown-links.test.ts` **gates**
relative markdown links in the required `unit-tests` job, while `local:docs`
owns what a deterministic check cannot reach (prose paths, `related:` ids,
stale notes). Do not duplicate the CI half in the desk job.

Each task has its own `agentName` (`chm-desk`, `chm-babysit`, `chm-prod`,
`chm-improve`, `chm-secrets`, `chm-redjobs`, `chm-stale`, `chm-docs`) and
therefore its own long-lived manager session and worktree.
Two jobs sharing an `agentName` race for one session — that bug cost a run on
2026-09-26 when `herdr-desk/.herdr-desk.json` still said `"name": "chmonitor"`.
Minutes are also checked against the other desks on this host, not just this
repo.

**Check the desk before trusting it.** A desk that fails silently looks exactly
like a desk with nothing to do:

```sh
herdr plugin action invoke herdr-desk.status   # `Fails` column must be `-`
bun src/cli.ts status                          # or from a herdr-desk checkout
herdr plugin action invoke herdr-desk.last     # today's changes.md
```

`Fails` counts consecutive failed fires. A non-empty value is a broken job:
read the error in `herdr plugin action invoke herdr-desk.history` and fix it
before trusting any output from that job. `Next: -` means the cron can never
match — a config bug. (A stale `LATEST` *directory* used to kill every fire
permanently; fixed in herdr-desk #15.)

**Auto-deployment** is not a job: `.github/workflows/cloudflare.yml` deploys the
dashboard on every push to `main` and runs `verify-deploy.ts` in the same
workflow. `local:prod` is the second pair of eyes — it catches a deploy that was
green in CI and is still broken in production. It may open a revert PR; it may
run `wrangler rollback` only when `CLOUDFLARE_API_TOKEN` **and**
`CHM_ALLOW_INSTANT_ROLLBACK=1` are both set, and only when service is down now —
and it must still open the revert PR afterwards so `main` and production
converge.

## Worktree hygiene

The desk grows worktrees, so the desk owns not leaving them behind.

- **Never remove a worktree with uncommitted work.** Commit it to its own
  branch first (a local `wip(...)` commit is fine) so it cannot be lost.
- **Prove a branch landed before deleting it.** Squash merges change the sha,
  so `git branch --merged main` is not evidence:

  ```sh
  git diff <branch> origin/main -- $(git diff --name-only \
    $(git merge-base origin/main <branch>) <branch>)   # empty = landed
  ```

  A branch can show `ahead 4` and be fully merged — that is squash, not work.
- One worktree per issue, one branch per child, one PR per child. Re-prompt a
  child that is already working an issue instead of starting a second one.
- **Know which class you are looking at before removing anything.** Worktrees
  accumulate here in three shapes, and only the first two have a Herdr Space:

  | Path | Has a Space? | Reached by `herdr worktree remove`? | How to remove |
  |---|---|---|---|
  | `~/.herdr/worktrees/chmonitor/desk-*` | yes | yes | never — live manager, leave it |
  | `~/.herdr/worktrees/chmonitor/<task>` | yes | yes | `herdr worktree remove <name>` |
  | `.claude/worktrees/agent-*` | **no** | **no** | `git worktree remove <path>` |
  | a record whose directory is gone | n/a | **no** | `git worktree prune` |

  Plain `git worktree remove` is *correct* for the Space-less rows precisely
  because there is no Space to leave behind — the opposite of the warning in the
  desk manager prompt. That inversion is the reason this is easy to get backwards.
- **Stale lock, owner process gone:** re-run the clean and landed checks
  *first*, then `git worktree unlock <path>`, then remove. Unlocking first
  defeats the check. 4 of 16 leaked checkouts refused their first removal pass
  on exactly this.
- `git fsck` clean after a cleanup pass, and `git worktree list` still shows only
  real checkouts. See `docs/herdr-desk/babysit-prs.md` § Worktree hygiene.

## Project Overview

This is a monorepo ClickHouse monitoring dashboard. The primary (and only) dashboard app is `apps/dashboard` (TanStack Start, as of v0.3). The Next.js migration is complete — the TanStack Start app has replaced the legacy Next.js app and is now at `apps/dashboard`. The application connects to ClickHouse instances and provides real-time insights into clusters through system tables — metrics, query performance, table information, and cluster health.

## One codebase: Self-hosted (OSS) + Cloud (SaaS)

`dash.chmonitor.dev` is the **Cloud (SaaS)** product; Docker / Kubernetes / a
self-built Cloudflare Worker are the **self-hosted (OSS)** product. They are the
SAME codebase — the difference is purely runtime configuration. The split is the
**cloud-mode** flag (`lib/cloud/cloud-mode.ts`).

**Design invariant (fail-closed to self-hosted):** an unset/junk
`CHM_CLOUD_MODE` / `VITE_CLOUD_MODE` resolves to NOT cloud, so the OSS build is
never degraded. Cloud behaviour is purely additive. Mirrors `lib/edition` (which
already lists `cloud` as an enterprise feature) and its fail-open philosophy.

| Aspect | Self-hosted (default) | Cloud (`CHM_CLOUD_MODE=true`) |
|--------|----------------------|-------------------------------|
| `CLICKHOUSE_HOST` env hosts | The operator's real hosts, full access | A **public read-only demo** (`source: 'demo'`, e.g. `duet-ubuntu`) |
| Anonymous visitor | Sees env hosts | Sees the read-only demo (explore without an account) |
| Signed-in user | Sees env hosts | Demo is **hidden** ("empty it") → their own per-user (D1) connections only; zero → welcome/setup page |
| Auth | usually `none` | Clerk, with `CHM_CLERK_PUBLIC_READ=true` (anon reads, writes need sign-in) |
| Per-user connections | optional | on (`CHM_FEATURE_USER_CONNECTIONS_DB=true`) |

**Environment is centralized — one canonical name, one source of truth.** Each
dual-surface setting (browser + server) has ONE canonical `CHM_*` name; the
client `VITE_*` is DERIVED from it in `vite.config.ts`, so you set each value
ONCE (e.g. set `CHM_AUTH_PROVIDER`, never also `VITE_AUTH_PROVIDER`). The hosted
product's non-secret config lives in committed `apps/dashboard/.env.production`
(+ `.env.preview` overlay) — the SINGLE source for both the vite client build
(`CHM_BUILD_ENV=production|preview`, npm `build:production`/`build:preview`) and the Worker
runtime vars. `wrangler.toml` declares NO `[vars]`; `apps/dashboard/scripts/patch-wrangler-env.ts`
injects them from `.env.production` at deploy. Self-hosters use `apps/dashboard/.env.example`
(same names) on Docker (`docker-compose.yml` `env_file`) / K8s (Helm `values.yaml`).
Secrets NEVER live in committed `.env*` — only in `scripts/set-secrets.ts` / a
K8s Secret / `.env.local`. **Never re-add a `[vars]` block to `wrangler.toml` —
edit `.env.production`.**

**Deployment mode (the ONE high-level switch):** `CHM_DEPLOYMENT_MODE=oss`
(default) `| cloud` resolves good defaults for cloud mode, auth provider,
public-read, and per-user storage — so a cloud deploy is just `CHM_DEPLOYMENT_MODE=cloud`
and an OSS deploy is the default (set `CHM_AUTH_PROVIDER=clerk|trusted` to add
auth). Each individual `CHM_*` flag still overrides its mode default. Every
reader goes through one resolver: booleans via `lib/config/parse-bool.ts`
(true/1/yes/on), the server auth provider via `getAuthProvider()` (runtime
`CHM_AUTH_PROVIDER` → baked `VITE_AUTH_PROVIDER` → runtime mode default →
baked mode default; a baked provider is never lowered by a runtime mode), public read via
`resolveConfig().clerkPublicRead`.
Source: `lib/config/deployment-mode.ts` (`parseDeploymentMode` / `modeDefaults` /
`resolveConfig`). Fail-closed to oss, like `lib/cloud` / `lib/edition`.

**Where cloud mode is wired:**
- `lib/config/deployment-mode.ts` — `CHM_DEPLOYMENT_MODE` → resolved defaults; consulted by the readers below when an explicit flag is unset.
- `lib/cloud/cloud-mode.ts` — `isCloudModeClient()` / `isCloudModeServer()` / `parseCloudMode()` (server derives from `CHM_DEPLOYMENT_MODE` when `CHM_CLOUD_MODE` unset).
- `apps/dashboard/.env.production` (+ `.env.preview`) — single source: `CHM_CLOUD_MODE=true`, `CHM_FEATURE_USER_CONNECTIONS_DB=true`, etc.
- `vite.config.ts` `loadDeployEnv` + CLIENT_ENV + `src/vite-env.d.ts` — derive/inline `VITE_CLOUD_MODE` (build) from the canonical `CHM_*`.
- `apps/dashboard/scripts/patch-wrangler-env.ts` — reads `.env.production`/`.env.preview` → Worker runtime `[vars]` (the @cloudflare/vite-plugin strips `[vars]` from the generated config).
- `.github/workflows/cloudflare.yml` build step — runs `build:preview` (PRs) / `build:production` (main); values come from the `.env*` files, not hardcoded.
- `lib/swr/use-merged-hosts.ts` — demo tagging + hide-when-signed-in; returns `cloudMode` / `isSignedIn`.
- `components/host/host-switcher.tsx` — "Demo / read-only" badges; treats `demo` like `env` for live status.
- `components/host/first-run-empty-state.tsx` — the redesigned welcome/setup page (3 modes: cloud signed-in, cloud anon, self-hosted).

**Connection-error help:** `lib/connection-errors.ts` classifies "Test connection"
failures (host_not_allowed/SSRF, invalid_url, auth_failed, access_denied,
dns/refused/tls/timeout) into title + cause + fix + docs slug. Rendered by
`ConnectionErrorPanel` in `connection-form.tsx`. Docs page:
`docs/content/guide/guides/connection-errors.mdx` (slug `guides/connection-errors`).

**Self-hosted stays whole:** never gate a core monitoring feature behind cloud
mode. Cloud-only behaviour = demo hosts + welcome framing + per-user storage,
nothing that removes functionality from OSS.

## Claude Skills

### chmonitor Agent Skill

For comprehensive dashboard knowledge, use the standalone agent skill:

```bash
npx skills add chmonitor/chmonitor
```

The skill covers:
- Dashboard navigation and features
- API endpoints and usage
- Query monitoring, table management, merge operations
- Development patterns and conventions
- ClickHouse version compatibility

**Repository**: https://github.com/chmonitor/chmonitor

### Internal: clickhouse-query-config

For version-aware query patterns:
- `sql: VersionedSql[]` with `since` field
- BackgroundBar column format (base, readable_column, pct_column)
- ClickHouse system table schema compatibility

**Quick Reference: BackgroundBar Columns**

When asked to "format background bar for: X, Y, Z", each column needs 3 SQL columns:
```sql
-- For "rows"
rows,                                                                    -- base
formatReadableQuantity(rows) AS readable_rows,                           -- display
round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows       -- percentage
```

See `.claude/skills/clickhouse-query-config.md` for full patterns.

## Project skills (Claude Code) & auto-improvement

Project-local Claude Code skills live in `.claude/skills/` as real `SKILL.md`
dirs (NOT `.agents/skills/`, which the `build:skills` registry scans for
end-user AI-agent skills — keep dev/product skills out of there so they never
leak into the agent bundle). Current dev skills:

- **`product-design`** — design system + UX conventions; read it before building
  or reviewing ANY UI so new features stay consistent. Backed by
  `docs/knowledge/product-design.md`.
- **`cloud-saas-mode`** — Cloud (SaaS) vs self-hosted behaviour, demo hosts,
  welcome/setup, per-user connections, connection-error classifier. Backed by
  `docs/knowledge/cloud-saas-mode.md`.
- **`pstack`** — project-local CI-first validation router and feature map for
  dashboard, API/auth/security, PeerDB, webhooks, Helm/GitOps, deploy, and
  CLI work, plus a pinned upstream skills-only copy under
  `.claude/skills/pstack/upstream/`. Backed by
  `docs/knowledge/pstack-validation.md`.
- **`verify-production`** — how to prove the *deployed* product works (not just
  that the Worker answers): the `verify-deploy.ts` contract, what each health
  endpoint does and does not prove, agent/guest-model probes, usage and quota
  watch, and the restore-service order (revert PR first; `wrangler rollback` only
  as an opt-in emergency). Use it after any deploy, when triaging "no data" or
  "the agent does not answer", and before any rollback. It replaced the stale
  `.claude/skills/verify-deploy.md`, which pointed at the deleted
  `apps/dashboard-tsr/` path. Backs the `local:prod` desk job.
- **`release-screenshots`** — capture, privacy-check, pick, crop, and frame
  release images (blog posts, changelog, social) with the bundled
  `frame.html` + `render.mjs`. Backed by `docs/knowledge/release-screenshots.md`.

**Auto-improve project skills (standing instruction).** These skills are living
documents — keep them accurate as the codebase evolves, without being asked:

1. Whenever you add or change a durable UI pattern, design token, reusable
   component, onboarding/error convention, or cloud-vs-OSS behaviour, UPDATE the
   relevant skill **and** its `docs/knowledge/*.md` backing doc **in the same
   change** (treat a skill that drifts from the code as a bug).
2. Bump the `updated:` date in the knowledge doc; keep the skill `description`
   trigger list current so it still activates for the right requests.
3. When you discover a new cross-cutting convention worth enforcing, add it to
   the appropriate skill (or create a new `.claude/skills/<name>/SKILL.md`), then
   link it from this section and the Knowledge Graph table below.
4. Never commit a regenerated `apps/dashboard/src/lib/ai/agent/skills/registry.ts`
   as a side effect of dev-skill work — that file tracks AI-agent skills only.

## Knowledge Graph

Developer-facing docs live in `docs/knowledge/` as a linked knowledge graph. Each note has frontmatter (`id`, `type`, `related`, `tags`) and cross-links to connected notes.

**Discovery order**: AGENTS.md → [docs/knowledge/README.md](docs/knowledge/README.md) → `grep -r "keyword" docs/knowledge/`

| Category | Document | Summary |
|----------|----------|---------|
| Architecture | [static-site-architecture.md](docs/knowledge/static-site-architecture.md) | TanStack Start + CF Worker; static shell, TanStack Query, `?host=0` routing |
| Architecture | [rust-wasm-performance.md](docs/knowledge/rust-wasm-performance.md) | WASM benchmarks: keep object transforms in TS |
| Architecture | [memory-optimization.md](docs/knowledge/memory-optimization.md) | Pooling, memoization, cache limits, monitoring |
| Operations | [deployment.md](docs/knowledge/deployment.md) | Docker + Cloudflare Workers dual deployment |
| Operations | [core-memory.md](docs/knowledge/core-memory.md) | Automation memory: code-smell scans, dead-code rules |
| Operations | [issue-desk.md](docs/knowledge/issue-desk.md) | The eight desk jobs and what each owns, repo-owned playbooks, the EISDIR outage that silenced 24 fires, worktree rules |
| Operations | [secret-rotation.md](docs/knowledge/secret-rotation.md) | Redeploy after `wrangler secret put` |
| Operations | [k8s-health-probes.md](docs/knowledge/k8s-health-probes.md) | /healthz (liveness, static) vs /api/healthz (readiness, CH-gated); startupProbe; :latest stale-image CrashLoop incident; non-helm manifest + migration prompt |
| Specs | [cloud-saas-mode.md](docs/knowledge/cloud-saas-mode.md) | One codebase, two products: cloud-mode flag, demo hosts for anon, welcome/setup, per-user D1 connections, connection-error classifier |
| Design | [product-design.md](docs/knowledge/product-design.md) | Design system + UX conventions: OKLCH tokens, shadcn rules, ChartCard/Container, EmptyState, graceful errors, ?host routing, file org (source of truth for the `product-design` skill) |
| Specs | [ai-insights.md](docs/knowledge/ai-insights.md) | AI Insights engine: collect→enrich→persist (findings store), cron + manual generation, stable-key dismissal, overview panel |
| Specs | [agent-eval.md](docs/knowledge/agent-eval.md) | Live promptfoo eval vs /api/v1/agent; AnyRouter llm-rubric; PR path filter |
| Specs | [metadata-db-optional-config.md](docs/knowledge/metadata-db-optional-config.md) | Metadata-DB-optional config: audit of the 12 D1-gated alert/settings stores, ENV + ConfigMap path for a DB-free deploy, precedence rule, read-only vs writable boundary, the `CHM_CONFIG_FILE` dead-config finding, and the corrected finding that `metadataDb.available` duplicates `lib/state-backend/config.ts` and is wrong in both directions |
| Specs | [agent-tool-catalog.md](docs/knowledge/agent-tool-catalog.md) | Agent tool catalog: `TOOL_CATALOG` side table, the core set, `search_tools` bound to the post-gate tool map, which anti-drift test catches what, and the measured schema-token cost |
| Specs | [mcp-server.md](docs/knowledge/mcp-server.md) | MCP server at /api/mcp: tools, setup, security |
| Specs | [agentstate-conversation-store.md](docs/knowledge/agentstate-conversation-store.md) | AgentState conversation backend: store priority, per-user external_id/tag isolation, append-only upsert, AI enrichment, backend/follow-ups routes |
| Specs | [query-config-format.md](docs/knowledge/query-config-format.md) | QueryConfig type, versioned SQL, BackgroundBar |
| Specs | [cluster-topology.md](docs/knowledge/cluster-topology.md) | Cluster topology SVG: layout pipeline, constant contracts, OKLCH `hsl(var())` gotcha, shared component, verification harness |
| Development | [component-ci-stability.md](docs/knowledge/component-ci-stability.md) | Cypress component-testing lessons for the two local specs; the `component-test` CI job was decommissioned in #1623 |
| Development | [conventions.md](docs/knowledge/conventions.md) | Coding conventions, file org, component patterns |
| Tools | [standalone-cli.md](docs/knowledge/standalone-cli.md) | `chm`/`chmonitor` Rust CLI: live TUI, local `add`/`ls`/`use`, dashboard API, `chm doctor`, channels |
| Development | [pstack-validation.md](docs/knowledge/pstack-validation.md) | Project-local pstack adapter, pinned upstream skills subtree, validation inventory, CI-first feature matrix, and evidence rules |
| Operations | [install-sh-bot-fight.md](docs/knowledge/install-sh-bot-fight.md) | curl install.sh 403 from Bot Fight Mode; GitHub raw workaround; `cf:allow-install-sh` |
| Design | [release-screenshots.md](docs/knowledge/release-screenshots.md) | Release images: privacy gate, one idea per image, branded frames, `render.mjs` to 2000x1250 WebP |

### When to Write to Knowledge vs Memory

- **Write to `docs/knowledge/`**: rules, conventions, architecture decisions, past incidents, "always do X" instructions, non-obvious workflows
- **Write to session memory**: user profile, transient preferences, ephemeral task state

When the user says **"remember"** something — write it to `docs/knowledge/`, not memory. Memory is per-instance and invisible to teammates. Knowledge docs are versioned, grep-able, and indexed here.

## Commands

**Note: This project uses `pnpm` as the package manager (`pnpm@10.18.0`, via corepack).** Use `pnpm` instead of `npm`/`yarn`/`bun` for installing dependencies and running package scripts. `bun` is still installed, but ONLY as the **test runner** (`bun test`, used by the `test:*` scripts) and as a **runtime for `.ts` scripts** (`bun scripts/foo.ts`) — never for package management.

### Setup

- `pnpm install` - Install all dependencies (required before dev/build). pnpm is enforced by the `preinstall` hook (`npx only-allow pnpm`), and `prepare` installs Husky hooks.

### Development

- `pnpm run dev` - Start development server (Vite dev, via turbo)
- `pnpm run build` - Build for production (Vite build + tsc --noEmit)
- `pnpm run start` - Start production server (node target)

**Verification workflow:** After making changes, always run `pnpm run build` to catch type errors. The build includes TypeScript type checking via `tsc --noEmit`. If `node_modules/` is missing, run `pnpm install` first.

### Testing

- `pnpm run test` - Run the full test suite (bun test runner, orchestrated via turbo)
- `pnpm run test:unit` - Run targeted unit tests for core app/component suites
- `pnpm run test:query-config` - Run query-config-specific tests
- `pnpm run test:coverage` - Run tests with coverage output
- `pnpm run test:watch` - Run tests in watch mode
- `pnpm run test:component` - Open Cypress component tests
- `pnpm run test:component:headless` - Run Cypress component tests headless
- `pnpm run test:e2e` - Open Cypress e2e tests
- `pnpm run test:e2e:headless` - Run Cypress e2e tests headless

### Code Quality

- `pnpm run lint` - Run Biome linting
- `pnpm run fmt` - Format code with Biome
- `pnpm run depcruise` - Validate dependency boundaries (no cycles, layering, no packages→apps)
- If Biome CLI and `biome.json` schema versions drift, run `biome migrate` before linting changes.

### Deployment

#### Unified Deploy Script (CI + Local)

The same deploy command works in both CI and local environments:

```bash
cd apps/dashboard && pnpm run cf:deploy
```

This runs inside `apps/dashboard` and executes:

1. Vite build (CF target via `@cloudflare/vite-plugin`)
2. `wrangler deploy --minify` — Deploy to the `chmonitor-dash` worker at `dash.chmonitor.dev`

No OpenNext, no KV/R2/D1 cache population step — the TanStack Start build produces a native Workers bundle directly.

**Auth**: Set `CLOUDFLARE_API_TOKEN` in your environment (CI secrets or `.env.production.local`).
Falls back to `wrangler login` OAuth for local development.

#### Cloudflare Workers Commands

- `cd apps/dashboard && pnpm run cf:deploy` — Build + deploy to Cloudflare Workers
- `pnpm run cf:config` — Set Cloudflare secrets from `.env.production.local` or `.env.local`
- `cd apps/dashboard && pnpm run cf-typegen` — Regenerate Cloudflare environment typings

#### Docker Deployment

- `docker compose up -d` — Quick start
- `pnpm run docker:health` — Check Docker health

#### Prerequisites

Both environments need these env vars (set via `.env.production.local`, `.env.local`, or CI secrets):

| Variable | Required | Purpose |
|----------|----------|---------|
| `CLOUDFLARE_API_TOKEN` | For deploy | Cloudflare API token (recommended over OAuth) |
| `CLICKHOUSE_HOST` | Yes | ClickHouse URL |
| `CLICKHOUSE_USER` | Yes | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | Yes | ClickHouse password |

Optional: `CLERK_SECRET_KEY`, LLM API keys, etc.

#### CI Environment (GitHub Actions)

Production deploys happen on push to `main`. The CI workflow in
`.github/workflows/cloudflare.yml` builds `apps/dashboard` (TanStack Start) and
deploys it using the same env var names — just sourced from GitHub Secrets instead
of local files.

### Additional Workflows

- `pnpm run check` / `pnpm run check:fix` - Run Biome's full check suite, with optional write mode
- `pnpm run lint:fix` - Apply Biome lint fixes
- `pnpm run type-check` - Run standalone TypeScript verification
- `pnpm run test:unit`, `pnpm run test:query-config`, `pnpm run test:coverage` - Narrow test runs for common workflows
- `pnpm run build:skills` - Regenerate the AI skills registry from `.agents/skills/`
- `bun run scripts/build-ch-schema-docs.ts` - Regenerate ClickHouse schema docs (`--version`, `--table`, `--verbose`)
- `bun scripts/set-secrets.ts` - Set Cloudflare Worker secrets directly (same operation as `pnpm run cf:config`)
- `pnpm run docker:health` / `pnpm run cf:health` - Check Docker or deployed health endpoints
- `pnpm run lint && pnpm run build` - Quick local CI parity check (matches core lint/build workflow jobs)
- Code-smell/dead-code automation: see [docs/knowledge/core-memory.md](docs/knowledge/core-memory.md)
- Since-last-run scan scope: `git log --since='<ISO_TIME>' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Since-last-run scan scope (source commits only): `git log --since='<ISO_TIME>' --no-merges --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Fallback scan (24h): `git log --since='24 hours ago' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Fallback scan (7d): `git log --since='7 days ago' --name-only --pretty=format: | sed '/^$/d' | sort -u`
- Empty-window rule: if since-last-run has zero commits, run 24h then 7d fallback and report no-op when both are empty
- Dead-code evidence: `rg -n "\b<SYMBOL>\b" --glob '!**/__tests__/**' --glob '!**/*.test.*' --glob '!**/*.spec.*'`
- Main CI status check: `gh run list --branch main --limit 10 --json workflowName,status,conclusion,headSha,url`
- PR CI status check: `gh pr checks <PR_NUMBER> --watch=false`
- Failed-job logs in restricted cache environments: `XDG_CACHE_HOME=/private/tmp/gh-cache gh run view <RUN_ID> --job <JOB_ID> --log-failed`
- E2E page-load flake triage: `XDG_CACHE_HOME=/private/tmp/gh-cache gh run view <RUN_ID> --job <JOB_ID> --log-failed | grep -n -E "Timed out after waiting .* for your remote page to load"`
- Worktree fallback for PR operations: if automation checkout is detached (`git status --short --branch` shows `HEAD (no branch)`), stale versus `origin/main`, or git metadata writes fail (`FETCH_HEAD`/`HEAD.lock`/`index.lock`), run `git -C /Users/duet/project/clickhouse-monitor fetch origin`; if that checkout is dirty, create a clean worktree under `/private/tmp` for commit/PR commands
- Cloudflare worker size dry-run: `pnpm exec wrangler deploy --minify --dry-run`
- Code-smell automation workflow now records findings in `docs/knowledge/core-memory.md`, then validates `gh run list --branch main --limit 10 ...` and keeps a dedicated memory note under `/Users/duet/.codex/automations/code-smell-detector/memory.md`.

**Docs content workflow**: `docs/content/**` is the committed source of truth for the docs. The **Fumadocs + TanStack Start** site at `apps/docs` (→ docs.chmonitor.dev) generates its content collection from it via `apps/docs/scripts/sync-docs.mjs` on every build. There is no per-release versioning.

- `cd apps/docs && pnpm run dev` - Preview the docs site locally (http://localhost:3001)
- `cd apps/docs && pnpm run build` - Full build (sync-docs → generate-og → vite build incl. prerender)
- Edit only `docs/content/**`; `apps/docs/content/docs/**` is regenerated and gitignored.

**IMPORTANT — keep the AI Agent docs in sync**: `docs/content/guide/ai-agent.mdx` is
the user-facing reference for the agent's tools, skills, and configuration.
Whenever you add, rename, or remove an agent tool (`lib/ai/agent/tools/*.ts`), a
skill (`.agents/skills/*/SKILL.md`), or an agent env var, update
`docs/content/guide/ai-agent.mdx` in the same change so the docs do not drift.

## Architecture

> **NOTE:** `apps/dashboard` is now the TanStack Start app (v0.3+). The Next.js migration is complete. For the app internals, see `apps/dashboard/AGENTS.md` or `docs/PRD.md` §10.2.
>
> **Where the historical reference ends:** the Next.js-era material runs from `### Legacy: Next.js Static Site Architecture` down to and including `#### SWR Data Fetching Pattern`. Everything after that heading — `#### Data Table System` onward, including all of `### Development Conventions`, `## Common Tasks`, and `## Important Files` — is current and describes the TanStack Start app. The `#### SWR Data Fetching Pattern` heading is a leftover name; the hooks it once documented are now TanStack Query.

### Core Technologies (TanStack Start, current)

- **TanStack Start** (TanStack Router, file-based routing, SSR-capable)
- **Vite** with `@cloudflare/vite-plugin` — native Cloudflare Workers bundle
- **React 19** with TypeScript
- **TanStack Query** for server-state, caching, and data fetching
- **TanStack Table** for data tables
- **ClickHouse clients** (@clickhouse/client and @clickhouse/client-web)
- **Tailwind v4** with shadcn/ui components
- **Recharts 3.x** for charts
- **Vercel AI SDK** + assistant-ui for the AI agent

Deployment: Cloudflare Workers (`chmonitor-dash` worker → `dash.chmonitor.dev`), Docker, or Kubernetes.

### Static-First Rendering (TanStack Start)

Pages are prerendered at build time (static shell) with client-side data fetching via TanStack Query. The Worker SSR layer handles auth and API routes.

- All dashboard pages are file-based routes under `src/routes/(dashboard)/`
- API routes live at `src/routes/api/`
- Multi-host routing via `?host=0` query param (unchanged from v0.2)

---

### Legacy: Next.js Static Site Architecture (historical reference — no longer in use)

**CRITICAL**: Fully static site. No SSR, no middleware, no server components. Client-side only.

- Use `'use client'` for all pages
- Use client-side redirect (`useRouter` + `useEffect`), never `redirect()` from next/navigation
- Use SWR for all data fetching
- Query params for routing (`?host=0`), not dynamic routes

### Legacy: Routing Pattern

**Old (Dynamic)**: `https://example.com/0/overview`
**New (Static)**: `https://example.com/overview?host=0`

**Benefits:**
- Faster initial page load (static shell pre-rendered)
- Better CDN caching (static pages cache at edge)
- Simpler deployment (standalone output)
- Progressive data loading (client fetches data independently)

### File Structure

```
app/
├── api/v1/              # API routes for data fetching
│   ├── data/            # Generic query endpoint
│   ├── charts/[name]/   # Chart-specific data
│   ├── tables/[name]/   # Table data with pagination
│   ├── explorer/        # Data explorer API (dependencies, projections)
│   └── hosts/           # List available hosts
├── overview/            # Static overview page (5 tabs: Connections, Queries, Merges, Replication, System)
├── dashboard/           # Static dashboard page
├── explorer/            # Static database explorer page with tree browser
├── tables/              # Static tables list
├── clusters/            # Static clusters overview
├── running-queries/     # Static query monitoring pages
├── [query]/             # Dynamic query detail routes
└── layout.tsx           # Root layout with SWR provider

components/
├── data-table/          # Advanced data table system
├── charts/              # Chart components (32 components)
│   └── * (all use SWR with hostId prop)
├── overview-chards/     # Overview page charts
├── header-client.tsx    # Client-side header with host selector
└── ui/                  # shadcn/ui components

lib/
├── api/
│   ├── types.ts         # API request/response types
│   ├── chart-registry.ts # Chart query registry
│   └── table-registry.ts # Table query registry
├── swr/
│   ├── provider.tsx     # SWR configuration
│   ├── use-host.ts      # Extract hostId from query params
│   ├── use-chart-data.ts # Chart data fetching hook
│   └── use-table-data.ts # Table data fetching hook
├── query-config/        # Centralized query configurations
│   ├── queries/         # Query monitoring configs
│   ├── merges/          # Merge operation configs
│   ├── more/            # System metrics configs
│   ├── tables/          # Table-specific configs
│   └── system/          # System-level configs
├── clickhouse.ts        # ClickHouse client (hostId required)
└── server-context.ts    # Server-side context
```

### Multi-Host Support

**IMPORTANT**: All data fetching now requires `hostId` parameter.

**Query Parameter Approach:**
```typescript
// URL: /overview?host=1
'use client'
import { OverviewCharts } from '@/components/overview-charts/overview-charts-client'

export default function OverviewPage() {
  // OverviewCharts and its child components use useHostId() internally
  return <OverviewCharts />
}
```

**Environment Variables:**
- `CLICKHOUSE_HOST` - Comma-separated list of hosts
- `CLICKHOUSE_USER` - Comma-separated list of users
- `CLICKHOUSE_PASSWORD` - Comma-separated list of passwords
- `CLICKHOUSE_NAME` - Comma-separated list of custom names

### Key Patterns

#### SWR Data Fetching Pattern

**All client components that fetch data follow this pattern:**

```typescript
'use client'
import { Suspense } from 'react'
import { useHostId } from '@/lib/swr'
import { ChartSkeleton } from '@/components/skeletons'
import { YourChart } from '@/components/charts/your-chart'

export default function YourPage() {
  const hostId = useHostId()

  return (
    <Suspense fallback={<ChartSkeleton />}>
      <YourChart hostId={hostId} />
    </Suspense>
  )
}
```

**Chart Components:**
```typescript
'use client'
import useSWR from 'swr'
import { useChartData } from '@/lib/swr/use-chart-data'

export function YourChart({ hostId }: { hostId: number }) {
  const { data, error, isLoading } = useChartData({
    name: 'your-chart-name',
    hostId,
    interval: 300000, // 5 minutes
  })

  if (isLoading) return <ChartSkeleton />
  if (error) return <ChartError error={error} />
  // ... render chart
}
```

#### Data Table System

The `components/data-table/` directory contains a sophisticated table system:

- **Column definitions** with custom formatting (badges, links, duration, etc.)
- **Column resizing** with draggable borders
- **Text wrapping** toggle for long content
- **Sorting** with custom sorting functions
- **Pagination** and **filtering**
- **Actions** for row-level operations
- **SQL display** showing the underlying query
- Synthetic utility column ids are `__expand`, `select`, and `action`; treat them as non-data columns when wiring client-side filter, search, sort, or card controls.

#### Query Configuration

Each data view uses a `QueryConfig` type that defines:

- SQL query with parameters
- Column formatting specifications
- Sorting and filtering options
- Actions available for each row

#### Chart Components

The project uses custom chart components with consistent patterns:

- **Area charts** - Time-series data with gradients (merge operations, query counts)
- **Bar charts** - Categorical data with tooltips (top tables by size, query counts)
- **Progress bars** - Replaced donut charts for percentage-based metrics (query cache, query types)
- **Donut/Radial charts** - Circular metrics for system resources (CPU, memory, disk)
- **Custom charts** - Specialized visualizations (connections, ZooKeeper metrics)

**Chart Refactoring**: Donut charts have been replaced with progress bars for better readability in percentage-based displays (query cache usage, query type distribution).

**Collapsible chart sections**: when a page hides an auto-refreshing chart strip, unmount the chart subtree instead of only collapsing it with CSS. Otherwise the hidden charts keep polling and rendering in the background. TanStack Query's 30-minute `gcTime` keeps reopen fast without paying that hidden-work cost.

#### Request Info (SQL) Dialog
- **Beautify SQL**: Disabled by default to prevent slow rendering of very large queries. Users can toggle it on manually.
- **Design**: Uses native shadcn/ui components (`Badge`, `Separator`, `ScrollArea`) for a premium look and consistent UI.

#### Agent Session Metrics
- **Location**: Agent settings sidebar.
- **Features**: Real-time monitoring of tokens (input/output), estimated cost, and tool calls.
- **Analytics Dialog**: Detailed breakdown of session analytics available via a premium dialog.
- **Usage**: Automatically aggregates metrics from AI SDK messages using `useAgentSessionStats`.

#### Graceful Error Handling Pattern

Charts use graceful error handling during a background refetch to preserve user experience:

- **Initial load errors**: Show full `ChartError` component with retry button
- **Revalidation errors**: Keep showing existing data with subtle amber indicator
- **Indicator behavior**: Hidden by default, visible on card hover (same pattern as CardToolbar)
- **Error details**: Click indicator to see error type, message, timestamp, and retry button
- **Auto-recovery**: Indicator clears automatically when next refresh succeeds

**Implementation**:
- `useChartData` returns `staleError` (revalidation error) and `hasData` boolean
- `ChartContainer` only shows `ChartError` when `error && !hasData`
- `ChartCard` renders `ChartStaleIndicator` when `staleError` exists
- Icon order in header: `[Stale Indicator] [DateRangeSelector] [CardToolbar]`

### Development Conventions

#### shadcn/ui Components

**IMPORTANT: Never customize `components/ui/` files directly.**

The `components/ui/` directory contains shadcn/ui components installed via the CLI. These should remain in their original state to:
- Allow easy updates via `npx shadcn@latest add <component>`
- Maintain consistency with shadcn/ui documentation
- Avoid merge conflicts when updating components

**Guidelines:**
1. **Don't add custom variants** (e.g., `success`, `warning`, `info`) to base components like Badge or Alert
2. **Don't add hover effects** or animations to Card, Table, or other base components
3. **Don't modify base styling** - use className prop at usage site instead

**If you need custom styling or variants:**
- Pass custom classes via `className` prop where the component is used
- Create a wrapper component in `components/` (not `components/ui/`)
- Use Tailwind's `cn()` utility to merge classes

**Example - Custom styling at usage site:**
```typescript
// Good: Custom classes passed where used
<Card className="hover:shadow-lg transition-all">
  <CardContent>...</CardContent>
</Card>

// Bad: Modifying components/ui/card.tsx directly
```

**Example - Creating a wrapper component:**
```typescript
// components/info-badge.tsx
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function InfoBadge({ className, ...props }) {
  return (
    <Badge
      className={cn(
        'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        className
      )}
      {...props}
    />
  )
}
```

#### File Organization

Vite ships one client bundle, so there is **no server/client component split**
and **no `"use client"` directive** — not one file under
`apps/dashboard/src/routes/` declares one.

- **Pages** are `apps/dashboard/src/routes/(dashboard)/<name>.tsx`, each
  exporting a `Route` via `createFileRoute('/(dashboard)/<name>')`
- **API routes** are `apps/dashboard/src/routes/api/<name>.ts`, with a
  `server.handlers` block (`GET` / `POST`) on the same `createFileRoute` call
- **The app shell** is `apps/dashboard/src/routes/__root.tsx` (providers,
  `HeadContent`, `Scripts`). It replaces the old `app/layout.tsx`; there is no
  `page.tsx` / `layout.tsx` / route `config.ts` convention any more.
- **Query configs** live in `apps/dashboard/src/lib/query-config/`, typed by
  `apps/dashboard/src/types/query-config.ts`
- **Navigation** is `apps/dashboard/src/menu.ts`, composed from
  `apps/dashboard/src/menu/<section>.ts`
- **UI** is `apps/dashboard/src/components/` — there is no repo-root
  `components/`, `app/`, or `lib/` directory

#### Component Patterns

- Plain React function components — there is no "server by default" split to opt out of
- `useState` / `useEffect` / context for interactivity
- Compound components for complex UI (e.g., data tables)
- Custom hooks for shared logic
- **Hooks at deepest consumer**: Use hooks (like `useHostId`, `useChartData`) at the component that actually needs the data, NOT at parent levels. Avoid prop drilling through intermediate components. Example: `CountBadge` calls `useHostId()` internally rather than receiving `hostId` as a prop from `NavMain → MenuGroup → MenuItem`.
- Keep route files thin — assemble UI in `apps/dashboard/src/components/`, not inline in `routes/`

#### Query Patterns

- All queries include `QUERY_COMMENT` for identification
- App code calls `fetchDataWithHost` (`apps/dashboard/src/lib/clickhouse-helpers.ts`), which normalizes `hostId` and delegates to `fetchData` from `@chm/clickhouse-client`
- Query parameters are properly sanitized through `query_params`
- **CRITICAL**: `hostId` is required for every query (not optional)
- Browser reads go through TanStack Query hooks: `apps/dashboard/src/lib/query/` for chart/table data, `apps/dashboard/src/lib/swr/` for hosts/config. **The directory `lib/swr/` is a leftover name — the library is TanStack Query, not SWR; there is no `swr` dependency.**
- Server route handlers under `apps/dashboard/src/routes/api/` call `fetchDataWithHost` directly, no hook involved

#### ClickHouse Version Compatibility

**IMPORTANT**: ClickHouse system tables change between versions. See `docs/clickhouse-schemas/` for:

- **Schema documentation** per version (`v23.8.md`, `v24.1.md`, etc.)
- **Column availability matrix** per table (`tables/query_log.md`, etc.)
- **Version-aware query patterns** with `since` field

**When modifying query configs:**
1. Check `docs/clickhouse-schemas/tables/{table}.md` for column availability
2. Use chronological `sql` array if columns differ across versions:

```typescript
export const myConfig: QueryConfig = {
  name: 'my-query',
  sql: [
    { since: '23.8', sql: `SELECT col1 FROM system.table` },
    { since: '24.1', sql: `SELECT col1, new_col FROM system.table` },
  ],
  columns: ['col1', 'new_col'],
}
```

**Regenerate schema docs:**
```bash
bun run scripts/build-ch-schema-docs.ts
```

See also: `.claude/skills/clickhouse-query-config.md` for Claude skill guidance.

#### Table Validation System

The application includes a robust table validation system to handle optional ClickHouse system tables that may not exist depending on configuration:

**Optional Tables** (marked with `optional: true`):

- `system.backup_log` - Only exists if backup configuration is enabled
- `system.error_log` - Requires error logging configuration
- `system.zookeeper` - Only available if ZooKeeper/ClickHouse Keeper is configured
- `system.monitoring_events` - Custom table created by the monitoring application

**Key Components**:

- `packages/clickhouse-client/src/table-validator.ts` - Validates table existence before queries
- `packages/clickhouse-client/src/table-existence-cache.ts` - Caches validation results (5-minute TTL)
- `apps/dashboard/src/lib/card-error-utils.ts` - Provides user-friendly error messages

**Usage Pattern**:

```typescript
export const backupsConfig: QueryConfig = {
  name: 'backups',
  optional: true, // Mark as optional
  tableCheck: 'system.backup_log', // Explicit table to check
  sql: 'SELECT * FROM system.backup_log',
  // ... other config
}
```

**Automatic Features**:

- SQL parsing automatically extracts table names from complex queries
- Handles JOINs, subqueries, CTEs, and EXISTS clauses
- Graceful error handling with informative user messages
- Caching prevents repeated validation calls

#### Testing Strategy

- **Bun test** for unit and query-config tests (`pnpm run test`, `pnpm run test:unit`, `pnpm run test:query-config`)
- **Cypress** for component and e2e tests
- **Query-config tests** run with `pnpm run test:query-config` against ClickHouse service containers in CI
- Component tests include visual regression testing
- Test files are co-located with components (`.cy.tsx` files)

## Environment Configuration

### Required Environment Variables

- `CLICKHOUSE_HOST` - ClickHouse host(s)
- `CLICKHOUSE_USER` - ClickHouse user(s)
- `CLICKHOUSE_PASSWORD` - ClickHouse password(s)

### Optional Environment Variables

See `apps/dashboard/.env.example` and `docs/content/reference/environment-variables.mdx`. Set `CHM_*`, not `VITE_*`.

## Common Tasks

### Adding a New Route

1. Add `apps/dashboard/src/routes/(dashboard)/your-route.tsx` exporting a
   `Route` via `createFileRoute('/(dashboard)/your-route')`
2. For a standard table view, add a `QueryConfig` to
   `apps/dashboard/src/lib/query-config/<domain>/` and register it in
   `apps/dashboard/src/lib/query-config/index.ts`
3. Render `<PageLayout queryConfig={...} />` inside
   `<Suspense fallback={<PageSkeleton />}>` — the page component itself needs
   no `useHostId()`; the layout and its charts read `hostId` from the `?host=0`
   search param
4. Add the OG head with `pageOgHead('your-route')` (add the slug to `OG_PAGES`
   in `apps/dashboard/src/lib/og.ts`)
5. Add a menu item in the matching `apps/dashboard/src/menu/<section>.ts`

**Template** (mirrors `apps/dashboard/src/routes/(dashboard)/merges.tsx`):
```tsx
// apps/dashboard/src/routes/(dashboard)/your-route.tsx
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { yourConfig } from '@/lib/query-config/your-domain/your-config'

function YourRoutePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageLayout queryConfig={yourConfig} />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/your-route')({
  component: YourRoutePage,
  head: () => pageOgHead('your-route'),
})
```

### Adding a New Chart Component

1. Create the component under `apps/dashboard/src/components/charts/` (or its
   domain subfolder)
2. Define the SQL in `apps/dashboard/src/lib/query-config/` if it doesn't exist
3. Read data with the TanStack Query `useChartData` hook from `@/lib/swr`,
   passing `chartName` (not `name`) plus `hostId` and a `refreshInterval`
4. Handle loading, error, and empty states
5. Export and register it where the page's chart strip is assembled

**Template** (mirrors `apps/dashboard/src/components/charts/summary-used-by-mutations.tsx`):
```tsx
// apps/dashboard/src/components/charts/your-chart.tsx
import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { ChartSkeleton } from '@/components/skeletons'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

export const ChartYourName = function ChartYourName({
  title,
  className,
  hostId,
}: ChartProps) {
  const { data, isLoading, error, mutate, sql } = useChartData<{
    your_count: number
  }>({
    chartName: 'your-chart-name',
    hostId,
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  if (isLoading) return <ChartSkeleton title={title} className={className} />
  if (error)
    return (
      <ChartError
        error={error}
        title={title}
        onRetry={mutate}
        className={className}
      />
    )

  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) return <ChartEmpty title={title} className={className} />

  return (
    <ChartCard title={title} sql={sql} data={rows} className={className}>
      {/* Chart rendering */}
    </ChartCard>
  )
}
```

### Modifying Data Tables

- Column formatters are in `apps/dashboard/src/components/data-table/cells/`
- Sorting functions are in `apps/dashboard/src/components/data-table/sorting-fns.ts`
- Actions are defined in `apps/dashboard/src/components/data-table/cells/actions/`

### Working with ClickHouse Queries

- Use `fetchData` for consistent error handling
- All queries should include proper parameter sanitization
- Log query performance through built-in logging
- Use appropriate data formats (JSONEachRow, JSON, etc.)
- **Always pass `hostId` parameter** (required, not optional)

## Important Files

### Core Application
- `apps/dashboard/vite.config.ts` - Vite + TanStack Start build config (Cloudflare Workers / Node dual target)
- `apps/dashboard/src/routes/__root.tsx` - Root route: app shell, providers, `HeadContent`/`Scripts`
- `apps/dashboard/src/routes/index.tsx` - Root redirect to `/overview?host=0`
- `apps/dashboard/src/components/host/host-switcher.tsx` - Header host selector

### Data Layer
- `packages/clickhouse-client/src/index.ts` - ClickHouse client and `fetchData` (hostId required)
- `apps/dashboard/src/lib/swr/use-host.ts` - Extract hostId from query params (TanStack Query; `lib/swr/` is a leftover directory name)
- `apps/dashboard/src/lib/query/use-chart-data.ts` - TanStack Query hook for chart data
- `apps/dashboard/src/lib/query/use-table-data.ts` - TanStack Query hook for table data
- `apps/dashboard/src/lib/api/chart-registry.ts` - Chart query registry
- `apps/dashboard/src/lib/query-config/index.ts` - Centralized query configurations

### Configuration
- `apps/dashboard/src/menu.ts` - Navigation menu configuration (static routes)
- `.env.local` - Environment variables for ClickHouse hosts

### Types
- `apps/dashboard/src/lib/api/types.ts` - API request/response types
- `apps/dashboard/src/types/query-config.ts` - Query configuration types

## Migration Notes

The subsections below record the **v0.2 (Dec 2024) Next.js-era** migration.
Their `app/`, SWR, and Next.js build-mode references are history — for current
state read `## Architecture` above, `apps/dashboard/AGENTS.md`, and the
**Deployment** section under `## Commands`.

### Completed (Dec 2024)
- Migrated from dynamic `app/[host]/*` routes to static routes with `?host=` query parameter
- All 32 chart components converted to use SWR with `hostId` prop
- API routes created at `/api/v1/*` for data fetching
- Query configs centralized in `lib/query-config/`

### Breaking Changes
- URL structure changed: `/0/overview` → `/overview?host=0` (still current)
- `fetchData()` now requires `hostId` parameter (was optional) — still current
- All data fetching moved to client-side via SWR — **superseded**: server-state
  is TanStack Query today, and API route handlers fetch server-side

### Deployment
- Build mode: `output: 'standalone'` (hybrid static + API) — **superseded**: that
  was the Next.js `output` key. There is no OpenNext and no standalone build;
  the Vite build emits a native Workers bundle.
- Deploy to Cloudflare Workers: `npx wrangler login` then `pnpm run cf:deploy`
  — still current, see **Deployment** under `## Commands`

## AI Agents

The agent subsystem lives at `apps/dashboard/src/lib/ai/agent/` and is built on the **Vercel AI SDK** (not LangGraph). It has 29+ tool categories (schema, query, diagnostics, anomaly, cluster, visualization, etc.) assembled by `tools/index.ts`. Agent prompts are in `lib/ai/agent/prompts/`, skills in `lib/ai/agent/skills/`, and workflows in `lib/ai/agent/workflows/`.

For the agent environment variables and configuration, see `apps/dashboard/src/lib/ai/agent/` or `docs/content/guide/ai-agent.mdx`.
