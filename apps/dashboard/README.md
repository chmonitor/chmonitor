# dashboard — ClickHouse Monitoring (TanStack Start)

The ClickHouse monitoring dashboard on **TanStack Start + Cloudflare Workers** —
the official dashboard (it replaced the legacy Next.js app in v0.3, #1392). Live at
**[dash.chmonitor.dev](https://dash.chmonitor.dev)** (preview:
`preview.dash.chmonitor.dev` on PRs).

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chmonitor/chmonitor/tree/main/apps/dashboard)

Click the button above to deploy your own instance to Cloudflare Workers. You will be prompted to connect your Cloudflare account and set the required environment variables.

### Required variables

| Variable | Purpose |
|---|---|
| `CLICKHOUSE_HOST` | ClickHouse URL(s). Comma-separated for multi-host (e.g. `https://ch1:8443,https://ch2:8443`) |
| `CLICKHOUSE_USER` | Username(s). Single value or one per host, comma-separated |
| `CLICKHOUSE_PASSWORD` | Password(s). Single value or one per host, comma-separated |

### Optional variables

| Variable | Purpose |
|---|---|
| `CLICKHOUSE_NAME` | Friendly display name(s) for each host, comma-separated |
| `CLICKHOUSE_MAX_EXECUTION_TIME` | Query timeout in seconds (default: `60`) |
| `VITE_AUTH_PROVIDER` | Auth mode: `none` (default) or `clerk` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_...`). Required when `VITE_AUTH_PROVIDER=clerk` |
| `CLERK_SECRET_KEY` | Clerk server secret (`sk_...`). Required when auth provider is `clerk` |
| `CHM_AUTH_PROVIDER` | Server-side auth mirror of `VITE_AUTH_PROVIDER` (`none` / `clerk` / `proxy`) |
| `CHM_API_KEY_SECRET` | Enables Bearer-token auth on `/api/v1/*` |
| `LLM_API_KEY` | AI provider key (OpenRouter, AnyRouter, etc.) |
| `LLM_API_BASE` | AI provider base URL (e.g. `https://openrouter.ai/api/v1`) |
| `LLM_MODEL` | Model to use (e.g. `openrouter/free`, `anyrouter/free`) |
| `OPENROUTER_API_KEY` | OpenRouter API key (alternative to `LLM_API_KEY`) |
| `ANYROUTER_API_KEY` | AnyRouter API key (alternative to `LLM_API_KEY`) |

`VITE_*` variables are baked into the browser bundle at build time; `CLICKHOUSE_*` and secret keys are runtime Worker variables set via `wrangler secret put` or the Cloudflare dashboard.

88 page routes and 53 API routes cover the full feature set: real-time cluster
metrics, query/merge/mutation monitoring, a database explorer, ClickHouse Keeper
views, log inspection, and an AI agent — all served as a fast static shell with
client-side data loading.

## Why TanStack Start (vs the Next app)

Same features, leaner substrate. Versus the former Next.js app (measured, post-merge main):

| | Next.js (v0.2) | TanStack (v0.3) |
|---|---|---|
| Worker bundle (gzip) | 2,708 KiB | **1,793 KiB** (−34%, 42% headroom under CF's 3 MiB cap) |
| Build time | 116 s | **~9 s** |
| Worker startup | — | **~25 ms** |
| Dependencies | 142 | 83 |

## Architecture

- **Static-first.** Every route is prerendered to static HTML at build (fast
  first paint, served from the Cloudflare edge), with a SPA fallback for any
  non-crawled route. Dynamic data loads client-side via **TanStack Query**
  against the `/api/v1/*` routes — "fast like SSR" without paying SSR per request.
- **Worker API.** `src/routes/api/**` run in the Cloudflare Worker (`workerd`)
  and talk to ClickHouse via `@chm/clickhouse-client`.
- **Bundle discipline.** Client-only heavy libs (recharts, xyflow, assistant-ui,
  json-render, codemirror, streamdown, highlight.js, assistant-stream) are
  **stubbed out of the SSR/worker bundle** in `vite.config.ts` — they only run in
  lazy client chunks, so they never count against the 3 MiB Worker limit.
- **Dual build target** from one source: default → Cloudflare Worker;
  `BUILD_TARGET=node` → a Nitro node-server build (`.output/server`) for Docker.

## Stack

- TanStack Start (TanStack Router) on Vite, React 19, TypeScript
- `@cloudflare/vite-plugin` → `workerd` SSR bundle (no OpenNext)
- TanStack Query (client data fetching/cache), TanStack Table (data grids)
- Tailwind v4 (`@tailwindcss/vite`, CSS-first), shadcn/ui
- Deploy: `wrangler deploy` (worker `chmonitor-dash`)

## Features

- **Overview & insights** — cluster KPIs, activity/query/record/traffic stats, charts
- **Queries** — running, history, failed, common-errors, expensive (by time & memory), explain
- **Merges & mutations** — merges, merge-performance, mutations, moves, detached-parts
- **Tables & storage** — explorer (tree browser + DDL/preview/dependencies), disks, backups, dropped-tables, mergetree-settings
- **Clusters & replication** — clusters, replicas-status, distributed-ddl-queue
- **ClickHouse Keeper** — overview, connections, watches, logs, info
- **System** — metrics, asynchronous-metrics, dictionaries, kafka-consumers, logs (text/crashes/stack-traces)
- **AI** — agent chat (`/agents`, `/ai-chat`) and a remote **MCP** server at `/api/mcp`

## Develop

```bash
pnpm install            # isolated install (own lockfile — see below)
pnpm run dev            # vite dev (generates src/routeTree.gen.ts on first run)
pnpm run build          # vite build + tsc --noEmit (type-check)
pnpm run test           # bun test src/
pnpm run cf:dry-run     # build + wrangler deploy --dry-run (bundle size, no creds)
```

`src/routeTree.gen.ts` is generated by the `tanstackStart()` plugin and gitignored.

## Deploy

Production deploys are **automatic on merge to `main`** via
`.github/workflows/cloudflare.yml` (the `dashboard` job builds and deploys to
`dash.chmonitor.dev`; PRs deploy to `preview.dash.chmonitor.dev`).

Manual deploy:

```bash
export CLOUDFLARE_API_TOKEN=...   # or `wrangler login`
pnpm run cf:deploy                 # build + wrangler deploy
bun scripts/verify-deploy.ts      # post-deploy health check
```

Node/Docker target: `pnpm run build:node` → `pnpm run start:node`.

## Configure

Runtime vars/secrets are injected per environment (CI secrets or `wrangler secret put`),
never committed. Client-exposed vars are `VITE_`-prefixed (`import.meta.env`); server
vars come from the Worker binding / `process.env`.

| Variable | Required | Purpose |
|---|---|---|
| `CLICKHOUSE_HOST` | ✅ | ClickHouse URL(s), comma-separated for multi-host |
| `CLICKHOUSE_USER` | ✅ | Username(s) |
| `CLICKHOUSE_PASSWORD` | ✅ | Password(s) |
| `CLICKHOUSE_NAME` | | Friendly host name(s) |
| `CLICKHOUSE_DATABASE` | | Default database |
| `CLICKHOUSE_MAX_EXECUTION_TIME` | | Query timeout (default 60s) |
| `VITE_AUTH_PROVIDER` / `CHM_AUTH_PROVIDER` | | `none` (default) \| `clerk` \| `proxy` |
| `CHM_API_KEY_SECRET` | | Enables API-key auth on `/api/v1/*` |
| `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | | When auth provider is `clerk` |
| `LLM_API_KEY` / `LLM_API_BASE` / `LLM_MODEL` | | AI agent (OpenRouter/AnyRouter-compatible) |

### Security headers

Applied with full coverage: a TanStack Start request middleware
(`src/lib/security-headers.ts`) sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, and `Permissions-Policy` on **worker/API responses**, and
`public/_headers` applies the same set to **prerendered static pages** (which are
served from the edge and bypass the worker).

## Isolation (own lockfile, not a root workspace)

This app carries its **own `bun.lock`** and installs in isolation (run
`pnpm install` from inside `apps/dashboard`) — the same pattern as `apps/landing`
and `apps/docs`. Its vite bundling resolves the shared `@chm/*` packages' npm
deps from THIS app's own `node_modules`, so it cannot be a root workspace member
(hoisting would scatter those deps and break the hardcoded resolve aliases).

Shared `@chm/*` packages are resolved from **source** (no `workspace:*`): `tsconfig`
`paths` for `tsc`, `vite.config` `resolve.alias` + `ssr.noExternal` so Vite
transpiles and bundles them into the worker.
