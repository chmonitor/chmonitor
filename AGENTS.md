# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Commit Convention

**IMPORTANT**: All commits should include the co-authorship:
```
Co-Authored-By: duyetbot <bot@duyet.net>
```

Use semantic commit format with consistent scope for commit messages and PR titles. Keep wording simple. Never mention external design references, visual inspiration sites, or comparative platforms in commit messages, PR titles, or PR descriptions.

## PR Workflow

**Always auto-babysit PRs on this project.** After opening any PR, immediately arm
auto-merge (`gh pr merge --auto --squash`) and babysit it (`/github:babysit-pr`):
watch CI, fix failures, confirm the merge and production deploy. Do NOT ask the
user whether to babysit — just do it. Known non-required checks (`e2e-test`,
`e2e-test-tsr`, `component-test`) do not block auto-merge. `unit-tests` IS a
required check (required alongside `dashboard` since 2026-07-10, plan 75).

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
runtime vars. `wrangler.toml` declares NO `[vars]`; `scripts/patch-wrangler-env.ts`
injects them from `.env.production` at deploy. Self-hosters use `apps/dashboard/.env.example`
(same names) on Docker (`docker-compose.yml` `env_file`) / K8s (Helm `values.yaml`).
Secrets NEVER live in committed `.env*` — only in `scripts/set-secrets.ts` / a
K8s Secret / `.env.local`. **Never re-add a `[vars]` block to `wrangler.toml` —
edit `.env.production`.**

**Deployment mode (the ONE high-level switch):** `CHM_DEPLOYMENT_MODE=oss`
(default) `| cloud` resolves good defaults for cloud mode, auth provider,
public-read, and per-user storage — so a cloud deploy is just `CHM_DEPLOYMENT_MODE=cloud`
and an OSS deploy is the default (set `CHM_AUTH_PROVIDER=clerk|trusted` to add
auth). Each individual `CHM_*` flag still overrides its mode default.
Source: `lib/config/deployment-mode.ts` (`parseDeploymentMode` / `modeDefaults` /
`resolveConfig`). Fail-closed to oss, like `lib/cloud` / `lib/edition`.

**Where cloud mode is wired:**
- `lib/config/deployment-mode.ts` — `CHM_DEPLOYMENT_MODE` → resolved defaults; consulted by the readers below when an explicit flag is unset.
- `lib/cloud/cloud-mode.ts` — `isCloudModeClient()` / `isCloudModeServer()` / `parseCloudMode()` (server derives from `CHM_DEPLOYMENT_MODE` when `CHM_CLOUD_MODE` unset).
- `apps/dashboard/.env.production` (+ `.env.preview`) — single source: `CHM_CLOUD_MODE=true`, `CHM_FEATURE_USER_CONNECTIONS_DB=true`, etc.
- `vite.config.ts` `loadDeployEnv` + CLIENT_ENV + `src/vite-env.d.ts` — derive/inline `VITE_CLOUD_MODE` (build) from the canonical `CHM_*`.
- `scripts/patch-wrangler-env.ts` — reads `.env.production`/`.env.preview` → Worker runtime `[vars]` (the @cloudflare/vite-plugin strips `[vars]` from the generated config).
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

**Discovery order**: CLAUDE.md → [docs/knowledge/README.md](docs/knowledge/README.md) → `grep -r "keyword" docs/knowledge/`

| Category | Document | Summary |
|----------|----------|---------|
| Architecture | [static-site-architecture.md](docs/knowledge/static-site-architecture.md) | TanStack Start + CF Worker; static shell, TanStack Query, `?host=0` routing |
| Architecture | [rust-wasm-performance.md](docs/knowledge/rust-wasm-performance.md) | WASM benchmarks: keep object transforms in TS |
| Architecture | [memory-optimization.md](docs/knowledge/memory-optimization.md) | Pooling, memoization, cache limits, monitoring |
| Operations | [deployment.md](docs/knowledge/deployment.md) | Docker + Cloudflare Workers dual deployment |
| Operations | [core-memory.md](docs/knowledge/core-memory.md) | Automation memory: code-smell scans, dead-code rules |
| Operations | [secret-rotation.md](docs/knowledge/secret-rotation.md) | Redeploy after `wrangler secret put` |
| Operations | [k8s-health-probes.md](docs/knowledge/k8s-health-probes.md) | /healthz (liveness, static) vs /api/healthz (readiness, CH-gated); startupProbe; :latest stale-image CrashLoop incident; non-helm manifest + migration prompt |
| Specs | [cloud-saas-mode.md](docs/knowledge/cloud-saas-mode.md) | One codebase, two products: cloud-mode flag, demo hosts for anon, welcome/setup, per-user D1 connections, connection-error classifier |
| Design | [product-design.md](docs/knowledge/product-design.md) | Design system + UX conventions: OKLCH tokens, shadcn rules, ChartCard/Container, EmptyState, graceful errors, ?host routing, file org (source of truth for the `product-design` skill) |
| Specs | [ai-insights.md](docs/knowledge/ai-insights.md) | AI Insights engine: collect→enrich→persist (findings store), cron + manual generation, stable-key dismissal, overview panel |
| Specs | [mcp-server.md](docs/knowledge/mcp-server.md) | MCP server at /api/mcp: tools, setup, security |
| Specs | [agentstate-conversation-store.md](docs/knowledge/agentstate-conversation-store.md) | AgentState conversation backend: store priority, per-user external_id/tag isolation, append-only upsert, AI enrichment, backend/follow-ups routes |
| Specs | [query-config-format.md](docs/knowledge/query-config-format.md) | QueryConfig type, versioned SQL, BackgroundBar |
| Specs | [cluster-topology.md](docs/knowledge/cluster-topology.md) | Cluster topology SVG: layout pipeline, constant contracts, OKLCH `hsl(var())` gotcha, shared component, verification harness |
| Development | [component-ci-stability.md](docs/knowledge/component-ci-stability.md) | Cypress component test fragility and fixes |
| Development | [conventions.md](docs/knowledge/conventions.md) | Coding conventions, file org, component patterns |
| Tools | [standalone-cli.md](docs/knowledge/standalone-cli.md) | Rust CLI for monitoring via terminal and TUI |

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

Optional: `CLERK_SECRET_KEY`, LLM API keys, `CLICKHOUSE_TZ`, etc.

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

**Docs content workflow**: `docs/content/**` is the committed source of truth for the docs. The standalone Astro **Starlight** site at `apps/docs` (→ docs.chmonitor.dev) generates its content collection from it via `scripts/sync-docs.mjs` on every build. There is no per-release versioning.

- `cd apps/docs && pnpm run dev` - Preview the docs site locally (http://localhost:4321)
- `cd apps/docs && pnpm run build` - Full static build (sync-docs → astro build incl. Pagefind)
- Edit only `docs/content/**`; `apps/docs/src/content/docs/**` is regenerated and gitignored.

**IMPORTANT — keep the AI Agent docs in sync**: `docs/content/ai-agent.mdx` is
the user-facing reference for the agent's tools, skills, and configuration.
Whenever you add, rename, or remove an agent tool (`lib/ai/agent/tools/*.ts`), a
skill (`.agents/skills/*/SKILL.md`), or an agent env var, update
`docs/content/ai-agent.mdx` in the same change so the docs do not drift.

## Architecture

> **NOTE:** `apps/dashboard` is now the TanStack Start app (v0.3+). The Next.js migration is complete. For the app internals, see `apps/dashboard/CLAUDE.md` or `docs/PRD.md` §10.2. The Next.js-era subsections below are kept as historical reference and no longer apply.

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

Charts use graceful error handling during SWR revalidation to preserve user experience:

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

- Server components use `.tsx` without "use client"
- Client components explicitly use "use client" directive
- Page components are in `app/[...]/page.tsx`
- Layout components are in `app/[...]/layout.tsx`
- Config files are named `config.ts` within route directories

#### Component Patterns

- Use Server Components by default
- Client components for interactivity (context, state management)
- Compound components for complex UI (e.g., data tables)
- Custom hooks for shared logic
- **Hooks at deepest consumer**: Use hooks (like `useHostId`, `useSWR`) at the component that actually needs the data, NOT at parent levels. Avoid prop drilling through intermediate components. Example: `CountBadge` calls `useHostId()` internally rather than receiving `hostId` as a prop from `NavMain → MenuGroup → MenuItem`.

#### Query Patterns

- All queries include `QUERY_COMMENT` for identification
- Use `fetchData` function for consistent error handling and logging
- Query parameters are properly sanitized through `query_params`
- **CRITICAL**: `fetchData` now requires `hostId` parameter (not optional)
- Client components use SWR hooks for data fetching
- Server components can use API routes for data fetching

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

- `lib/table-validator.ts` - Validates table existence before queries
- `lib/table-existence-cache.ts` - Caches validation results (5-minute TTL)
- `lib/error-utils.ts` - Provides user-friendly error messages

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

- `CLICKHOUSE_NAME` - Custom names for hosts
- `CLICKHOUSE_MAX_EXECUTION_TIME` - Query timeout (default: 60s)
- `VITE_TELEMETRY_ENABLED` - Enable opt-in product telemetry (off by default)
- `VITE_DEPLOY_TARGET` - Deployment target dimension for telemetry (`docker|helm|cf|dev|unknown`)

## Common Tasks

### Adding a New Static Route

1. Create directory in `app/` (e.g., `app/your-route/`)
2. Create `page.tsx` as client component using `useHostId()`
3. Add `QueryConfig` to `lib/query-config/` if needed
4. Add menu item to `menu.ts` with href `/your-route`
5. Use SWR hooks for data fetching

**Template:**
```typescript
// app/your-route/page.tsx
'use client'

import { Suspense } from 'react'
import { RelatedCharts, Table } from '@/components'
import { ChartSkeleton, TableSkeleton } from '@/components/skeletons'
import { useHostId } from '@/lib/swr'
import { yourConfig } from '@/lib/query-config'

export default function YourRoutePage() {
  const hostId = useHostId()

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<ChartSkeleton />}>
        <RelatedCharts relatedCharts={yourConfig.relatedCharts} hostId={hostId} />
      </Suspense>
      <Suspense fallback={<TableSkeleton />}>
        <Table title="Your Data" queryConfig={yourConfig} />
      </Suspense>
    </div>
  )
}
```

### Adding a New Chart Component

1. Create component in `components/charts/your-chart.tsx`
2. Define SQL query in `lib/query-config/` if not exists
3. Use SWR `useChartData` hook with `hostId` prop
4. Handle loading, error, and empty states
5. Export and use in pages or related charts

**Template:**
```typescript
// components/charts/your-chart.tsx
'use client'

import { useChartData } from '@/lib/swr/use-chart-data'
import { ChartSkeleton } from '@/components/skeletons'
import { ChartError } from '@/components/error-alert'

interface YourChartProps {
  hostId: number
  interval?: number
}

export function YourChart({ hostId, interval }: YourChartProps) {
  const { data, error, isLoading } = useChartData({
    name: 'your-chart-name',
    hostId,
    interval,
  })

  if (isLoading) return <ChartSkeleton />
  if (error) return <ChartError error={error} />
  if (!data || data.length === 0) return <div>No data available</div>

  // Render your chart using data
  return <div>{/* Chart rendering */}</div>
}
```

### Modifying Data Tables

- Column formatters are in `components/data-table/cells/`
- Sorting functions are in `components/data-table/sorting-fns.ts`
- Actions are defined in `components/data-table/cells/actions/`

### Working with ClickHouse Queries

- Use `fetchData` for consistent error handling
- All queries should include proper parameter sanitization
- Log query performance through built-in logging
- Use appropriate data formats (JSONEachRow, JSON, etc.)
- **Always pass `hostId` parameter** (required, not optional)

## Important Files

### Core Application
- `next.config.ts` - Next.js configuration (standalone output mode)
- `app/layout.tsx` - Root layout with SWR provider and Suspense
- `app/page.tsx` - Root redirect to `/overview?host=0`
- `components/header-client.tsx` - Client-side header with host selector

### Data Layer
- `lib/clickhouse.ts` - ClickHouse client and `fetchData` (hostId required)
- `lib/swr/use-host.ts` - Extract hostId from query params
- `lib/swr/use-chart-data.ts` - SWR hook for chart data
- `lib/swr/use-table-data.ts` - SWR hook for table data
- `lib/api/chart-registry.ts` - Chart query registry
- `lib/query-config/index.ts` - Centralized query configurations

### Configuration
- `menu.ts` - Navigation menu configuration (static routes)
- `.env.local` - Environment variables for ClickHouse hosts

### Types
- `lib/api/types.ts` - API request/response types
- `types/query-config.ts` - Query configuration types

## Migration Notes

### Completed (Dec 2024)
- Migrated from dynamic `app/[host]/*` routes to static routes with `?host=` query parameter
- All 32 chart components converted to use SWR with `hostId` prop
- API routes created at `/api/v1/*` for data fetching
- Query configs centralized in `lib/query-config/`

### Breaking Changes
- URL structure changed: `/0/overview` → `/overview?host=0`
- `fetchData()` now requires `hostId` parameter (was optional)
- All data fetching moved to client-side via SWR

### Deployment
- Build mode: `output: 'standalone'` (hybrid static + API)
- Deploy to Cloudflare Workers: `npx wrangler login` then `pnpm run cf:deploy`

## AI Agents

The agent subsystem lives at `apps/dashboard/src/lib/ai/agent/` and is built on the **Vercel AI SDK** (not LangGraph). It has 29+ tool categories (schema, query, diagnostics, anomaly, cluster, visualization, etc.) assembled by `tools/index.ts`. Agent prompts are in `lib/ai/agent/prompts/`, skills in `lib/ai/agent/skills/`, and workflows in `lib/ai/agent/workflows/`.

For the agent environment variables and configuration, see `apps/dashboard/src/lib/ai/agent/` or `docs/content/ai-agent.mdx`.
