---
title: "Vercel"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/deploy/vercel.mdx"
---

Deploy chmonitor to Vercel. This targets the legacy Next.js build (v0.2 and earlier). The current TanStack app (`apps/dashboard`) targets Cloudflare Workers; use [Cloudflare](/deploy/cloudflare) for that.

## Quick start

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fduyet%2Fclickhouse-monitoring&env=CLICKHOUSE_HOST,CLICKHOUSE_USER,CLICKHOUSE_PASSWORD,CLICKHOUSE_MAX_EXECUTION_TIME,CLICKHOUSE_TZ,NEXT_QUERY_CACHE_TTL)

Or deploy manually:

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Set environment variables in the Vercel dashboard (Project → Settings → Environment Variables).
3. Deploy.

## Build settings

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Build command | `pnpm run build` (or `npm run build`) |
| Output directory | `.next` |
| Install command | `pnpm install` |
| Node.js version | 22.x or later |

## Configure

Set environment variables in Vercel dashboard → Project → Settings → Environment Variables.

### Client vs server vars on Vercel

On Vercel (Next.js), client-side vars use `NEXT_PUBLIC_*`. These are inlined at build time. Server-side vars are plain names. This differs from the TanStack app which uses `VITE_*`.

| TanStack (current app) | Next.js / Vercel | Purpose |
|---|---|---|
| `VITE_AUTH_PROVIDER` | `NEXT_PUBLIC_AUTH_PROVIDER` | Auth provider (client) |
| `VITE_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client) |
| `VITE_TITLE_SHORT` | `NEXT_PUBLIC_TITLE_SHORT` | Branding (client) |

### ClickHouse connection

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLICKHOUSE_HOST` | Yes | — | ClickHouse URL(s), comma-separated |
| `CLICKHOUSE_USER` | No | `default` | Username(s), same count as HOST |
| `CLICKHOUSE_PASSWORD` | No | `""` | Password(s), same count as HOST |
| `CLICKHOUSE_NAME` | No | — | Friendly label(s) for host switcher |

#### Multiple hosts

All four variables must have the same count:

```
CLICKHOUSE_HOST=https://ch1:8443,https://ch2:8443
CLICKHOUSE_USER=monitoring,monitoring
CLICKHOUSE_PASSWORD=pass1,pass2
CLICKHOUSE_NAME=primary,replica
```

### Query / pool tuning

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_MAX_EXECUTION_TIME` | `60` | Query timeout in seconds |
| `CLICKHOUSE_TZ` | — | Timezone for queries |
| `NEXT_QUERY_CACHE_TTL` | `3600` | Query cache TTL in seconds |
| `CLICKHOUSE_DATABASE` | `system` | Default database |
| `CLICKHOUSE_POOL_SIZE` | `10` | Connection pool size |
| `CLICKHOUSE_POOL_TIMEOUT` | `300000` | Pool acquire timeout (ms) |
| `CLICKHOUSE_POOL_CLEANUP_INTERVAL` | `60000` | Pool cleanup interval (ms) |

### Feature permissions

Add to Vercel env vars:

```
CHM_DISABLED_FEATURES=peerdb,actions
CHM_AUTH_REQUIRED_FEATURES=agent,settings,mcp
CHM_FEATURE_AGENT_ACCESS=authenticated
CHM_FEATURE_SETTINGS_ENABLED=false
```

For a config file, set `CHM_CONFIG_FILE` to a path readable by the Vercel function runtime and include the file in the repo.

Feature ids: `overview`, `agent`, `insights`, `health`, `queries`, `tables`, `metrics`, `dashboard`, `security`, `logs`, `settings`, `cluster`, `operations`, `actions`, `mcp`, `docs`, `about`.

### Authentication

**None (default):**

```
CHM_AUTH_PROVIDER=none
```

**API key layer:**

```
CHM_API_KEY_SECRET=a-long-random-secret
```

**Clerk:**

```
## Server-side (plain var)
CHM_AUTH_PROVIDER=clerk
CLERK_SECRET_KEY=sk_live_...

## Client-side (NEXT_PUBLIC_ prefix; inlined at build)
NEXT_PUBLIC_AUTH_PROVIDER=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
```

**Proxy — Cloudflare Access:**

```
CHM_AUTH_PROVIDER=proxy
CHM_CF_ACCESS_TEAM_DOMAIN=https://yourteam.cloudflareaccess.com
CHM_CF_ACCESS_AUD=<audience-tag>
```

**Proxy — trusted header:**

```
CHM_AUTH_PROVIDER=proxy
CHM_PROXY_AUTH_HEADER=X-Forwarded-User
CHM_PROXY_AUTH_SECRET=a-long-random-secret
```

Put chmonitor behind a Vercel Edge Middleware or an upstream proxy that sets the header. See [Authentication](/authentication).

### AI agent

```
LLM_API_KEY=sk-...
LLM_API_BASE=https://openrouter.ai/api/v1
LLM_MODEL=openrouter/free
AGENT_API_TOKEN=bearer-token-for-agent-api
AGENT_ENABLE_CONTROL_TOOLS=false
```

Never use `NEXT_PUBLIC_LLM_API_KEY` — keep the key server-side only.

### Conversation store

**Default:** browser localStorage — no server config needed.

On Vercel, use `postgres` or `clickhouse` for server-side persistence. D1 and Durable Object stores are Cloudflare-only.

**Postgres (recommended on Vercel):**

```
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=postgres
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

Vercel Postgres, Neon, and Supabase all work. Add `DATABASE_URL` in the Vercel dashboard.

**ClickHouse store:**

```
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=clickhouse
CLICKHOUSE_AGENT_CONVERSATIONS_TABLE=system.agent_conversations
CLICKHOUSE_AGENT_CONVERSATIONS_AUTO_CREATE=true
```

### Health alerting

The health sweep endpoint is `GET /api/cron/health-sweep`. Trigger it from a Vercel Cron Job or an external cron:

In `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/health-sweep",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

```
HEALTH_ALERT_ENABLED=true
HEALTH_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
HEALTH_ALERT_MIN_SEVERITY=warning
CRON_SECRET=a-random-secret
```

### Branding

```
NEXT_PUBLIC_TITLE_SHORT=MyCluster
NEXT_PUBLIC_LOGO=/logo.png
NEXT_PUBLIC_MEASUREMENT_ID=G-XXXXXXXXXX
NEXT_PUBLIC_POSTHOG_KEY=phc_...
```

## Upgrading

1. Push to `main` (or merge a PR). Vercel auto-deploys.
2. For environment variable changes, update them in the dashboard and trigger a redeploy (Deployments → Redeploy).

For breaking changes between major versions, see [Migrating to v0.3](/migrating/v0-3).

## Limitations

- **No D1 / Durable Objects:** Cloudflare-only. Use postgres or clickhouse for conversation store.
- **Function timeout:** Vercel Hobby plan limits function duration to 10 s. Use Pro or set `CLICKHOUSE_MAX_EXECUTION_TIME` below that limit.
- **Cold starts:** Vercel serverless functions have cold starts. Set `CLICKHOUSE_POOL_SIZE` appropriately.
