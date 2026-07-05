---
title: "Cloudflare Workers"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/deploy/cloudflare.mdx"
---

Deploy chmonitor to Cloudflare Workers. Best for globally cached, serverless hosting with no servers to manage.

The dashboard app (`apps/dashboard`) uses the `@cloudflare/vite-plugin` to build a native Cloudflare Workers bundle — no OpenNext adapter required. The deploy script is just `pnpm run build && wrangler deploy`.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/duyet/clickhouse-monitoring/tree/main/apps/dashboard)

This deploys the `apps/dashboard` worker (TanStack Start). You will be prompted to connect your Cloudflare account and configure variables. See the [environment variable reference](#configure) below and the [dashboard README](https://github.com/duyet/clickhouse-monitoring/tree/main/apps/dashboard#deploy-your-own) for the full variable list.

## Prerequisites

- Cloudflare account
- Bun installed locally or in CI
- `CLOUDFLARE_API_TOKEN` with Workers deploy permissions (or run `wrangler login` for OAuth)

## Quick start

```bash
git clone https://github.com/duyet/clickhouse-monitoring.git
cd clickhouse-monitoring/apps/dashboard
pnpm install

## Set credentials and build
export CLICKHOUSE_HOST=https://clickhouse.example.com:8443

## Build the Cloudflare Workers bundle and deploy
pnpm run cf:deploy   # vite build → wrangler deploy
```

For secrets (ClickHouse password, LLM keys, etc.), use `wrangler secret put`:

```bash
wrangler secret put CLICKHOUSE_HOST
wrangler secret put CLICKHOUSE_PASSWORD
```

Open your Workers URL or set a custom domain in the Cloudflare dashboard.

## How configuration works on Cloudflare

There are two kinds of variables:

| Kind | Where to set | Who reads it | Example |
|---|---|---|---|
| **Build-time client vars** | CI env / shell before `pnpm run build` | Browser JS (VITE-inlined) | `VITE_AUTH_PROVIDER`, `VITE_CLERK_PUBLISHABLE_KEY` |
| **Runtime Worker vars** | `wrangler.toml` `[vars]` or `wrangler secret put` | Worker process only | `CLICKHOUSE_HOST`, `LLM_API_KEY`, `CLERK_SECRET_KEY` |

`VITE_*` vars are baked into the JS bundle at build time. Setting them in `wrangler.toml [vars]` has no effect — they must be in the environment when `pnpm run build` runs (e.g. CI secrets).

Runtime Worker vars (`wrangler.toml [vars]` and secrets) are never visible in the browser.

## wrangler.toml

Non-secret runtime vars go in `[vars]`:

```toml
name = "chmonitor"
main = "@tanstack/react-start/server-entry"
compatibility_date = "2026-05-28"
compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]

[observability]
enabled = true

[vars]
CLICKHOUSE_USER = "monitoring"
CLICKHOUSE_NAME = "prod"
CLICKHOUSE_MAX_EXECUTION_TIME = "30"
CLICKHOUSE_TZ = "UTC"
NEXT_QUERY_CACHE_TTL = "3600"
CLICKHOUSE_POOL_SIZE = "10"
CLOUDFLARE_WORKERS = "1"
HEALTH_ALERT_ENABLED = "true"
HEALTH_ALERT_MIN_SEVERITY = "warning"
AGENT_CONVERSATION_STORE = "d1"
AGENT_CONVERSATION_PERSISTENCE = "true"
CHM_AUTH_PROVIDER = "none"
LLM_API_BASE = "https://openrouter.ai/api/v1"
LLM_MODEL = "openrouter/free"
AGENT_ENABLE_CONTROL_TOOLS = "false"
```

Secrets go via `wrangler secret put` (never in `wrangler.toml`):

```bash
wrangler secret put CLICKHOUSE_HOST
wrangler secret put CLICKHOUSE_PASSWORD
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CHM_PROXY_AUTH_SECRET
wrangler secret put LLM_API_KEY
wrangler secret put CRON_SECRET
wrangler secret put CHM_API_KEY_SECRET
```

After `wrangler secret put`, redeploy so the Worker picks up the change: `pnpm run cf:deploy`.

## Configure

### ClickHouse connection

```bash
wrangler secret put CLICKHOUSE_HOST    # https://clickhouse.example.com:8443
wrangler secret put CLICKHOUSE_PASSWORD
```

```toml
[vars]
CLICKHOUSE_USER = "monitoring"
CLICKHOUSE_NAME = "prod"
```

#### Multiple hosts

`CLICKHOUSE_HOST` defines the host count. `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD` may be a single value (applied to all hosts) or one value per host position. `CLICKHOUSE_NAME` is optional:

```bash
wrangler secret put CLICKHOUSE_HOST     # https://ch1:8443,https://ch2:8443
wrangler secret put CLICKHOUSE_PASSWORD # pass1,pass2
```

```toml
[vars]
CLICKHOUSE_USER = "monitoring,monitoring"
CLICKHOUSE_NAME = "shard-1,shard-2"
```

### Query / pool tuning

```toml
[vars]
CLICKHOUSE_MAX_EXECUTION_TIME = "30"
CLICKHOUSE_TZ = "UTC"
NEXT_QUERY_CACHE_TTL = "3600"
CLICKHOUSE_DATABASE = "system"
CLICKHOUSE_POOL_SIZE = "10"
CLICKHOUSE_POOL_TIMEOUT = "300000"
CLICKHOUSE_POOL_CLEANUP_INTERVAL = "60000"
```

### Feature permissions

**Via wrangler.toml vars:**

```toml
[vars]
CHM_DISABLED_FEATURES = "peerdb,actions"
CHM_AUTH_REQUIRED_FEATURES = "agent,settings,mcp"
CHM_FEATURE_AGENT_ACCESS = "authenticated"
CHM_FEATURE_SETTINGS_ENABLED = "false"
```

**Via a mounted config file:** not directly supported in Workers — use env vars instead.

Feature ids: `overview`, `agent`, `insights`, `health`, `queries`, `tables`, `metrics`, `dashboard`, `security`, `logs`, `settings`, `cluster`, `operations`, `actions`, `mcp`, `docs`, `about`.

### Authentication

**None (default):**

```toml
[vars]
CHM_AUTH_PROVIDER = "none"
```

**API key layer:**

```bash
wrangler secret put CHM_API_KEY_SECRET
```

**Clerk:**

Set at build time in CI (these are `VITE_*` client vars):

```bash
## In your CI environment / GitHub Actions secrets:
VITE_AUTH_PROVIDER=clerk
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

Set the server secret at runtime:

```bash
wrangler secret put CLERK_SECRET_KEY   # sk_live_...
```

```toml
[vars]
CHM_AUTH_PROVIDER = "clerk"
```

**Proxy — Cloudflare Access (native option):**

Put chmonitor behind a Cloudflare Access application. The Worker verifies `Cf-Access-Jwt-Assertion` JWT from the Access JWKS.

```toml
[vars]
CHM_AUTH_PROVIDER = "proxy"
CHM_CF_ACCESS_TEAM_DOMAIN = "https://yourteam.cloudflareaccess.com"
CHM_CF_ACCESS_AUD = "<audience-tag>"
```

**Proxy — trusted header:**

```toml
[vars]
CHM_AUTH_PROVIDER = "proxy"
CHM_PROXY_AUTH_HEADER = "X-Forwarded-User"
CHM_PROXY_SHARED_SECRET_HEADER = "X-Chm-Proxy-Secret"
```

```bash
wrangler secret put CHM_PROXY_AUTH_SECRET
```

Without `CHM_PROXY_AUTH_SECRET`, trusted-header auth is disabled.

### AI agent

Set at runtime via secrets:

```bash
wrangler secret put LLM_API_KEY
wrangler secret put AGENT_API_TOKEN
```

```toml
[vars]
LLM_API_BASE = "https://openrouter.ai/api/v1"
LLM_MODEL = "openrouter/free"
AGENT_ENABLE_CONTROL_TOOLS = "false"
```

Never put `LLM_API_KEY` in a `VITE_*` var or `[vars]` — use `wrangler secret put`.

### Conversation store

**D1 (Cloudflare-native, recommended):**

Create a D1 database:

```bash
wrangler d1 create chmonitor-conversations
```

Add the binding to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "CHM_CLOUD_D1"
database_name = "chmonitor-conversations"
database_id = "<database-id-from-above>"
```

```toml
[vars]
AGENT_CONVERSATION_PERSISTENCE = "true"
AGENT_CONVERSATION_STORE = "d1"
CHM_CLOUD_D1_DATABASE_ID = "<database-id>"
```

Run migrations:

```bash
pnpm run cf:migrate-conversations
```

**Durable Object store:**

```toml
[vars]
AGENT_CONVERSATION_STORE = "durable-object"
AGENT_CONVERSATIONS_DO_BINDING = "AGENT_CONVERSATIONS_DO"
```

**ClickHouse or Postgres:** also available on Cloudflare Workers via outbound HTTP.

### Health alerting — Cron Trigger

Add a Cron Trigger in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

The Worker calls `GET /api/cron/health-sweep` every 5 minutes. Protect the endpoint:

```bash
wrangler secret put CRON_SECRET
wrangler secret put HEALTH_ALERT_WEBHOOK_URL
```

```toml
[vars]
HEALTH_ALERT_ENABLED = "true"
HEALTH_ALERT_MIN_SEVERITY = "warning"
```

### Branding

Set these in CI before running `pnpm run build` (they are baked into the JS bundle):

```bash
VITE_TITLE_SHORT=MyCluster
VITE_LOGO=/logo.png
VITE_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_POSTHOG_KEY=phc_...
```

## Deploy

```bash
pnpm run cf:deploy
```

This runs: `vite build` (produces the Cloudflare Workers bundle) → `wrangler deploy`.

**CI (GitHub Actions):** push to `main` triggers `.github/workflows/cloudflare.yml`. Set `CLOUDFLARE_API_TOKEN` as a repository secret, plus `CLICKHOUSE_*`, and any build-time `VITE_*` vars (e.g. `VITE_AUTH_PROVIDER`, `VITE_CLERK_PUBLISHABLE_KEY`).

## Preview locally

```bash
pnpm run cf:preview
```

## Cloudflare bindings

The app uses these Cloudflare resources (configured in `wrangler.toml`):

| Binding | Type | Purpose |
|---|---|---|
| `CHM_CLOUD_D1` | D1 Database | Conversation history (optional) |
| `AGENT_CONVERSATIONS_DO` | Durable Object | Conversation history via Durable Objects (optional) |

The TanStack Start build via `@cloudflare/vite-plugin` does not require KV, R2, or cache-tag bindings. Only conversation-store bindings need to be added if you enable server-side persistence.

## Upgrading

1. Pull the latest code: `git pull`.
2. Update dependencies: `pnpm install`.
3. Rebuild and deploy: `pnpm run cf:deploy`.

Worker secrets persist across deploys; you only need to re-run `wrangler secret put` when a value changes.

For breaking changes between major versions, see [Migrating to v0.3](/migrating/v0-3).

## Troubleshooting

**`wrangler deploy` ships nothing or stale assets:** run `pnpm run build` (or `pnpm run cf:deploy`, which does both) before `wrangler deploy` — the Vite build must produce the Workers bundle first.

**Runtime errors / blank pages:** check Workers logs in the Cloudflare dashboard. Verify secrets are set (`wrangler secret list`) and redeploy after any `wrangler secret put`.

**Build-time client var not taking effect:** `VITE_*` vars must be set in the environment when `pnpm run build` runs, not in `wrangler.toml [vars]`.
