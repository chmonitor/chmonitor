---
id: deployment
title: Deployment Guide
type: reference
status: active
updated: 2026-06-29
tags:
  - deployment
  - docker
  - cloudflare-workers
related:
  - secret-rotation
  - static-site-architecture
  - memory-optimization
---

# Deployment Guide

Dual deployment support: Docker and Cloudflare Workers from the same codebase.

> **Current architecture (TanStack Start, v0.3+):** the dual-runtime mechanism
> below is authoritative. The Next.js / OpenNext content further down (`.next`,
> `next build`, KV/R2/D1 cache populate) is **historical** and no longer applies
> — the app now builds via Vite + Nitro. See `apps/dashboard/vite.config.ts`.

## Environment configuration (single source of truth)

All env config flows from `.env*` files with **one canonical name per setting**.
There is no longer a parallel `wrangler.toml [vars]` block, a hardcoded CI build
env, and a `patch-wrangler-env.ts` table to keep in sync — that drift once
silently broke production (`CHM_FEATURE_USER_CONNECTIONS_DB` was set at client
build time but never as a Worker runtime var, so per-user connection storage
returned *"User connections database storage is not enabled"*).

### Canonical `CHM_*`, auto-derived `VITE_*`

A setting the **browser** needs is inlined into the client bundle at build time
as a `VITE_*` var (Worker runtime `[vars]` never reach the browser). You do NOT
set it twice. Set the canonical `CHM_*` name once and
`apps/dashboard/vite.config.ts` (the `CLIENT_ENV` block) derives the matching
`VITE_*` for the client:

```
set CHM_AUTH_PROVIDER  → vite derives VITE_AUTH_PROVIDER
set CHM_CLOUD_MODE     → vite derives VITE_CLOUD_MODE
set CHM_FEATURE_USER_CONNECTIONS_DB → vite derives VITE_FEATURE_USER_CONNECTIONS_DB
set CHM_CLERK_PUBLISHABLE_KEY → vite derives VITE_CLERK_PUBLISHABLE_KEY
```

Precedence per var (see `CLIENT_ENV` in `vite.config.ts`): explicit `VITE_*` →
canonical `CHM_*` → legacy `NEXT_PUBLIC_*` → committed default. The explicit
`VITE_*` / `NEXT_PUBLIC_*` forms still work as back-compat overrides.

### Where each target reads its env

| Target | Non-secret config | Secrets | Mechanism |
|--------|-------------------|---------|-----------|
| **Cloudflare (hosted)** | `apps/dashboard/.env.production` (+ `.env.preview` overlay for PR previews) | `scripts/set-secrets.ts` (from CI secrets) | `scripts/patch-wrangler-env.ts` injects every non-`VITE_` key as a Worker runtime `[var]` at deploy; the same files feed the vite client build via `CHM_BUILD_ENV=production\|preview` (npm `build:production` / `build:preview`) |
| **Docker** | `.env` (optional, `env_file` with `required: false` in `docker-compose.yml`) or `-e` flags; template is `.env.example` | `.env.local` / `-e` / orchestrator secret | plain `process.env`; client `VITE_*` is baked into the image at build time |
| **Kubernetes / Helm** | `values.yaml` → ConfigMap | Kubernetes `Secret` | `envFrom` ConfigMap + Secret; client `VITE_*` is baked into the image at build time |

`apps/dashboard/.env.example` is the self-hosted template (canonical names,
secret vs non-secret split). The **same names** work on every target — switching
from Docker to Wrangler is a config swap, not a re-learn.

### Rules

- **Never re-add a `[vars]` block to `wrangler.toml`.** The hosted product's
  non-secret config lives ONLY in `apps/dashboard/.env.production` (+ `.env.preview`).
  To change a hosted Worker runtime var, edit `.env.production` — `patch-wrangler-env.ts`
  reads it at deploy.
- **Secrets never live in committed `.env*`.** They go through
  `scripts/set-secrets.ts` (Cloudflare), a Kubernetes `Secret`, or local
  `.env.local`. The committed `.env.production` keeps `localhost` placeholders for
  private topology (`CLICKHOUSE_HOST/USER/NAME`), overridden at deploy from CI
  secrets via the strict allowlist in `patch-wrangler-env.ts`.
- A dual-surface setting (e.g. `CHM_AUTH_PROVIDER`) is still needed at **both**
  build time (so vite inlines its `VITE_*`) and runtime (so the server reads it)
  — but it is the same single canonical name in both places, not two names.

## Dual-runtime compatibility (Node Docker + Cloudflare Workers)

The TanStack Start app builds to **two targets** from one codebase, selected by
`BUILD_TARGET` in `apps/dashboard/vite.config.ts`:

| Target | Build | Runtime | `cloudflare:workers` resolves to |
|--------|-------|---------|-----------------------------------|
| `node` (Docker / k8s) | `pnpm run build:node:ci` → `.output/server/index.mjs` | Nitro `node-server` on `node:24-alpine` | `src/lib/cloudflare-workers-shim.ts` (`env` = `process.env`) |
| `cloudflare` (default `pnpm run build` / `cf:build`) | `@cloudflare/vite-plugin` → workerd bundle | Cloudflare Workers | workerd built-in binding |

### The contract (enforced by test)

Server routes read config via `import { env } from 'cloudflare:workers'`. On the
Node target that import is **aliased** to `cloudflare-workers-shim.ts`, which
re-exports `env` backed by `process.env`. The shim re-exports **only `env`** —
any other `cloudflare:workers` symbol (`WorkerEntrypoint`, `DurableObject`,
`ExecutionContext`, …) would be `undefined` under Node and break the Node build
**silently** (the Cloudflare target would still build and pass).

Guarded by `apps/dashboard/src/lib/__tests__/cloudflare-workers-shim.test.ts`:
the suite fails if any source file imports a symbol other than `env` from
`cloudflare:workers`. To use a new binding under Node, re-export it (Node-safe)
from the shim first.

### Audit (2026-06-18)

- Only `env` is imported from `cloudflare:workers` app-wide. ✅
- `/api/healthz` host ping is bounded by `AbortSignal.timeout()` on both runtimes
  (Node 18+ and workerd) — see [k8s-health-probes.md](k8s-health-probes.md).
- Worker-critical paths (`/api/healthz`, `/api/v1/host-status`,
  `/api/v1/notifications`) call `getClient({ web: true })` explicitly, so the
  fetch-based `@clickhouse/client-web` is selected regardless of runtime
  auto-detection.

### Known follow-ups (not blocking either runtime)

- `isCloudflareWorkers()` (`packages/clickhouse-client/.../runtime/cloudflare-workers.ts`)
  gates its global-shape check behind `typeof process === 'undefined'`, which is
  **false under `nodejs_compat`**. Auto-detection can mis-fire on a
  nodejs_compat Worker; mitigated today by explicit `web: true` on critical
  paths. Revisit (check `globalThis.caches` / `WebSocketPair` independently of
  `process`) if a new route relies on auto-detection.
- Most user-facing routes call `client.query()` with no client-side
  `abort_signal` (they rely on server-side `max_execution_time`). A hung
  ClickHouse host can stall those requests on both runtimes. Bounding them is a
  latency-hardening pass, not a runtime-compat fix.

## Build Artifacts

| Platform | Build Command | Entry Point |
|----------|--------------|-------------|
| **Docker** | `docker build` | `.next/standalone/server.js` |
| **Cloudflare** | `pnpm run cf:build` | `.open-next/worker.js` |

Both use `next build` with `output: 'standalone'` in `next.config.ts`.

## Unified Cloudflare Deploy (CI + Local)

The same script deploys from both CI and local:

```bash
pnpm run cf:deploy
```

This runs `scripts/cloudflare-deploy.ts` which executes:

1. `pnpm run cf:build` — Next.js build + OpenNext transform
2. `wrangler deploy --minify` — Deploy to Workers
3. `opennextjs-cloudflare populateCache remote` — Populate KV cache

**Auth priority**:
1. `CLOUDFLARE_API_TOKEN` env var (set in `.env.production.local` or CI secrets)
2. `wrangler login` OAuth (localhost fallback)

### Step-by-step (equivalent to CI)

```bash
pnpm run cf:config    # Set secrets from .env.production.local
pnpm run cf:build     # Build + OpenNext transform
wrangler deploy --minify
opennextjs-cloudflare populateCache remote
```

### CI

Production deploys on push to `main` via `.github/workflows/cloudflare.yml`. It uses
the same `pnpm run cf:build` command and the same env var names — secrets come
from GitHub Secrets instead of local files.

## Unified per-Worker deploy (`scripts/deploy-worker.ts`)

`pnpm run deploy:worker <app> [--env preview] [--dry-run] [--secrets-only|--no-secrets]`
(`bun scripts/deploy-worker.ts` directly) is the one script that publishes any
`apps/*` Worker with a `wrangler.toml` — `apps/dashboard`, `apps/cloud-hooks`,
`apps/bug-handler`, `apps/docs`, `apps/landing`, `apps/blog`, `apps/mcp`,
`apps/telemetry` — discovered dynamically (`--list` prints them).

- **`apps/dashboard`** is special-cased: the script shells out to the existing
  `cf:deploy` (patch-wrangler-env.ts) pipeline above rather than duplicating it.
- **Every other app** declares exactly which env it needs via a
  `apps/<app>/deploy.config.ts` manifest:
  ```ts
  export default {
    vars: ['CHM_POLAR_SERVER', 'CHM_POLAR_PRODUCT_*'], // trailing '*' = wildcard prefix match
    secrets: ['POLAR_WEBHOOK_SECRET', 'POLAR_ACCESS_TOKEN'],
  }
  ```
  Apps with no manifest deploy with no `--var`/secret pushing. Non-secret vars
  resolve from `apps/dashboard/.env.production` (+ `.env.preview` overlay for
  `--env preview`); secrets resolve from `apps/dashboard/.env.production.local`
  + `.env.local`, falling back to `process.env` for CI. An app's own
  `apps/<app>/.env.production(.local)` / `.env.preview` overrides the dashboard
  file when present. The script then runs `wrangler deploy --minify --var K:V
  ...` and `wrangler secret put <KEY>` per declared, resolved key — missing keys
  are skipped with a warning, not a hard failure.
- `--dry-run` prints the full plan (vars/secrets to push, the wrangler
  commands) with every value redacted; refuses to run for real without
  `CLOUDFLARE_API_TOKEN` set. `--secrets-only` skips the deploy step;
  `--no-secrets` skips pushing secrets.
- Example manifests: `apps/cloud-hooks/deploy.config.ts`,
  `apps/bug-handler/deploy.config.ts`. Pure logic (env merge/overlay
  precedence, manifest wildcard expansion, redaction) is covered by
  `scripts/deploy-worker.test.ts` (`bun test scripts/deploy-worker.test.ts`);
  wrangler calls run through an injectable exec function so tests never shell
  out for real.

## Docker

```bash
# Quick start with docker compose
docker compose up -d

# Or build manually
docker build -t clickhouse-monitor .
docker run -d -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://your-host.com \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=yourpassword \
  ghcr.io/chmonitor/chmonitor:latest
```

### Multi-stage Build

1. **deps**: `pnpm install --frozen-lockfile`
2. **builder**: `pnpm run build` → `.next/standalone/`
3. **runner**: Production image with only necessary files

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLICKHOUSE_HOST` | Yes | ClickHouse URL |
| `CLICKHOUSE_USER` | Yes | Username |
| `CLICKHOUSE_PASSWORD` | Yes | Password |
| `PORT` | No | Server port (default: 3000) |

### Health Check

```bash
pnpm run docker:health
```

## Cloudflare Environment Configuration

**Non-sensitive** (`wrangler.toml` `[vars]`):
```toml
CLICKHOUSE_HOST = "https://your-host.com"
CLICKHOUSE_USER = "default"
CLICKHOUSE_MAX_EXECUTION_TIME = "60"
CLOUDFLARE_WORKERS = "1"
```

**Secrets** (set via `pnpm run cf:config` or manually):
```bash
wrangler secret put CLICKHOUSE_PASSWORD
```

### Cloudflare Resources

| Resource | Binding | Purpose |
|----------|---------|---------|
| R2 Bucket | `NEXT_INC_CACHE_R2_BUCKET` | Incremental static cache |
| D1 Database | `NEXT_TAG_CACHE_D1` | Tag cache |
| KV Namespace | `NEXT_INC_CACHE_KV` | Incremental cache |
| Durable Objects | `NEXT_CACHE_DO_QUEUE` | Cache queue handler |

### Health Check

```bash
pnpm run cf:health
```

### Cron triggers (headless jobs)

`wrangler.toml` `[triggers] crons` schedules the secret-gated GET routes under
`src/routes/api/cron/`. The Cloudflare scheduled trigger is routed to the route's
`GET` handler; each route requires `CRON_SECRET` (`Authorization: Bearer` or
`?secret=`) and **fails closed (503) when it is unset**.

| Cron | Route | Notes |
|------|-------|-------|
| `0 3 * * *` | `retention-prune` | Daily 03:00 UTC. **Destructive** (deletes conversation rows past each plan's retention window). |
| `0 8 * * 1` | `weekly-report` | Mondays 08:00 UTC. Per-host opt-in via `CHM_WEEKLY_REPORT_HOSTS`; no-op when unset. |
| `*/10 * * * *` | `health-sweep` | Every 10 min (#2666). Runs health/anomaly checks + webhook alert fan-out headlessly. Gated by `CHM_HEALTH_SWEEP_ENABLED` (falsy → route no-ops 200; unset → enabled iff `CRON_SECRET` set). Also generates AI insights per host, so its cost scales with `CLICKHOUSE_HOST` count — 10 min (not 5) leaves CPU headroom; lengthen the cadence or set `CHM_HEALTH_SWEEP_ENABLED=false` for very large fleets. |

`CHM_HEALTH_SWEEP_ENABLED` is a non-secret Worker var: committed in
`apps/dashboard/.env.production` (`=true` for the hosted product) and documented
in `.env.example` for self-hosters. The `[env.preview]` worker declares no
`[triggers]`, so preview never runs these crons. See
`docs/content/guide/features/health.mdx` for the full alerting setup.

## Edge Routing & Host Redirects (4-worker topology)

Production runs four workers on the `chmonitor.dev` zone:

| Worker | Host / route |
|--------|--------------|
| `chmonitor-landing` | `chmonitor.dev` (apex marketing) |
| `chmonitor-dash` | `dash.chmonitor.dev` + `cloud.chmonitor.dev` (custom domains) |
| `chmonitor-mcp` | `dash.chmonitor.dev/api/mcp*` + `/api/v1/mcp/info*` (Workers Routes) |
| `chmonitor-docs` | `docs.chmonitor.dev` |

A specific Workers **Route** (`.../api/mcp*`) wins over a whole-hostname
**Custom Domain** (`dash.chmonitor.dev`) — sub-path routes are more specific —
so the MCP worker intercepts `/api/mcp` even though the dashboard owns the host.

### Preview topology (PR deployments)

Each PR deploys a parallel set of `preview-chmonitor-*` workers (`--env preview`)
under `preview.*` subdomains that mirror production exactly:

| Worker (preview) | Host / route |
|------------------|--------------|
| `preview-chmonitor-landing` | `preview.chmonitor.dev` (apex-preview) |
| `preview-chmonitor-dash` | `preview.dash.chmonitor.dev` (custom domain) |
| `preview-chmonitor-mcp` | `preview.dash.chmonitor.dev/api/mcp*` + `/api/v1/mcp/info*` (Workers Routes) |
| `preview-chmonitor-docs` | `preview.docs.chmonitor.dev` |

Wrangler auto-provisions DNS + TLS for a `custom_domain` route on first deploy,
**but custom domains are exclusive** — a hostname can attach to only one worker.
`preview.chmonitor.dev` originally lived on `preview-chmonitor-dash`; the cutover
to the per-app topology above detaches it there first (it cannot be auto-stolen),
then `preview-chmonitor-landing` claims it. The two new subdomains
(`preview.dash`, `preview.docs`) have no prior holder, so they provision cleanly.

**`cloud.chmonitor.dev` → `dash.chmonitor.dev` 301** is a Cloudflare edge
**Redirect Rule**, NOT Next.js middleware. `middleware.ts` cannot redirect the
prerendered static root: OpenNext serves `/` as an asset without invoking the
worker, so the host-redirect code never runs. A zone Redirect Rule fires at the
edge *before* the worker, covering every path uniformly. Provision/refresh it
(idempotent) with a `CLOUDFLARE_API_TOKEN` scoped to **Zone › Single Redirect ›
Edit** (manages the rule) **and Zone › Zone › Read** (the script resolves the
zone id first, so a token missing read still fails):

```bash
pnpm run cf:redirect-rule            # apply
pnpm run cf:redirect-rule --dry-run  # preview the ruleset payload
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Docker connection errors | Check ClickHouse accessibility and docker-compose depends_on |
| `__name is not defined` (CF) | `wrangler.toml` has `keep_names = false` |
| Build lock error | Remove `.next/lock` and retry |
| Secrets not updating | See [secret-rotation.md](secret-rotation.md) — redeploy after updating |
| `/api/mcp` → 503 "MCP API key auth is not configured" | `CHM_API_KEY_SECRET` empty on `chmonitor-mcp`. Worker secrets don't survive a rename. Set the GitHub secret (`pnpm run gh:sync-secrets`) and redeploy; CI pushes it to both workers. |
| `cloud.chmonitor.dev` returns 200 instead of 301 | Edge Redirect Rule missing — run `pnpm run cf:redirect-rule`. Middleware can't fix this (prerendered root skips the worker). |
