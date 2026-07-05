---
title: "Environment Variables"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/reference/environment-variables.mdx"
---

Full reference of every supported environment variable, grouped by category.

---

## Client variable prefix by app

Browser-exposed variables are **build-time inlined**. The prefix depends on which app you run:

| App | Client prefix | Example |
|---|---|---|
| `apps/dashboard` (TanStack Start, current) | `VITE_*` | `VITE_AUTH_PROVIDER` |
| Legacy Next.js (v0.2 and earlier) | `NEXT_PUBLIC_*` | `NEXT_PUBLIC_AUTH_PROVIDER` |

The tables below use `VITE_*`. If you are migrating from v0.2, substitute `NEXT_PUBLIC_` wherever you see `VITE_`. Server-side variables (`CLICKHOUSE_*`, `CHM_*`, `LLM_*`, `CLERK_SECRET_KEY`, etc.) are the same.

Authoritative example: [`apps/dashboard/.env.example`](https://github.com/duyet/clickhouse-monitoring/blob/main/apps/dashboard/.env.example).

---

## ClickHouse Connection

Required. Set at least `CLICKHOUSE_HOST`.

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_HOST` | — (required) | Comma-separated ClickHouse host URLs, e.g. `http://ch-1:8123,http://ch-2:8123`. |
| `CLICKHOUSE_USER` | `default` | Comma-separated usernames, one per host. |
| `CLICKHOUSE_PASSWORD` | `""` | Comma-separated passwords, one per host. |
| `CLICKHOUSE_NAME` | — | Comma-separated display labels shown in the host selector. |

`CLICKHOUSE_HOST` defines the host count. `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD` may be either a single value (applied to all hosts) or one value per host position. `CLICKHOUSE_NAME` is optional. Position N maps to host index N.

See [Multiple Hosts](/advanced/multiple-hosts) and [Custom Name](/advanced/custom-name).

---

## Query Execution

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_MAX_EXECUTION_TIME` | `60` | Query timeout in seconds. |
| `CLICKHOUSE_TZ` | server default | Time zone for date/time display. |
| `NEXT_QUERY_CACHE_TTL` | `3600` | Server-side query-result cache TTL in seconds. |
| `CLICKHOUSE_DATABASE` | `system` | Database used for app-owned tables (self-tracking events, dashboards). |
| `EVENTS_TABLE_NAME` | `system.monitoring_events` | Full table name override for self-tracking events. |

### Connection Pool

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_POOL_SIZE` | `10` | Max concurrent ClickHouse clients per host. |
| `CLICKHOUSE_POOL_TIMEOUT` | `300000` | Idle client timeout in milliseconds (5 min). |
| `CLICKHOUSE_POOL_CLEANUP_INTERVAL` | `60000` | Stale-client cleanup interval in milliseconds (1 min). |

---

## Health Alerting

The cron sweep (`GET /api/cron/health-sweep`, Cloudflare Cron Trigger every 5 minutes) runs health checks over all hosts and can post webhook alerts without a browser tab open. See [Environment Variables — Health Alerting](/reference/environment-variables#health-alerting) in context.

| Variable | Default | Description |
|---|---|---|
| `CRON_SECRET` | — | Shared secret guarding `/api/cron/health-sweep`. Send as `Authorization: Bearer <secret>`. When unset, the endpoint is open. |
| `HEALTH_ALERT_ENABLED` | `false` | Set `true` to POST webhook alerts. Checks run regardless; alerts only fire when `true`. |
| `HEALTH_ALERT_WEBHOOK_URL` | — | Slack- or Discord-compatible webhook URL. Required for alerts to be dispatched. |
| `HEALTH_ALERT_MIN_SEVERITY` | `warning` | Minimum severity to alert: `warning` (warning + critical) or `critical` (critical only). |

```bash
## Alert Slack on warning-or-worse
CRON_SECRET=a-long-random-string
HEALTH_ALERT_ENABLED=true
HEALTH_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
HEALTH_ALERT_MIN_SEVERITY=warning
```

---

## Feature Permissions

All features are public and enabled by default. Override only what needs different behavior.

| Variable | Default | Description |
|---|---|---|
| `CHM_CONFIG_FILE` | — | Path to TOML or YAML config file for feature overrides. |
| `CHM_DISABLED_FEATURES` | — | Comma-separated feature ids to disable entirely. |
| `CHM_AUTH_REQUIRED_FEATURES` | — | Comma-separated feature ids that require authentication. |
| `CHM_FEATURE_{ID}_ACCESS` | `public` | Per-feature access: `public`, `guest` (alias for public), or `authenticated`. |
| `CHM_FEATURE_{ID}_ENABLED` | `true` | Per-feature enabled flag: `true` or `false`. |

Replace `{ID}` with an uppercase feature id: `OVERVIEW`, `AGENT`, `INSIGHTS`, `HEALTH`, `QUERIES`, `TABLES`, `METRICS`, `DASHBOARD`, `SECURITY`, `LOGS`, `SETTINGS`, `CLUSTER`, `OPERATIONS`, `ACTIONS`, `MCP`, `DOCS`, `ABOUT`, `PEERDB`.

```bash
CHM_FEATURE_AGENT_ACCESS=authenticated
CHM_FEATURE_METRICS_ENABLED=false
CHM_DISABLED_FEATURES=settings,insights
```

See [Feature Permissions](/advanced/feature-permissions) for config-file examples and precedence details.

---

## Authentication

The active server-side auth provider is set by `CHM_AUTH_PROVIDER`. See [Authentication](/authentication) for the full model.

| Variable | Default | Description |
|---|---|---|
| `CHM_AUTH_PROVIDER` | `none` | Server auth provider: `none`, `clerk`, `proxy`, or `trusted`. |
| `VITE_AUTH_PROVIDER` | `none` | Client-side mirror of `CHM_AUTH_PROVIDER`. Set to the same value. Build-time. |
| `CHM_API_KEY_SECRET` | — | Shared secret for `chm_` API keys. When set, API-key auth is always on alongside the active provider. Issue keys at `/api/v1/auth/api-key`. |

### Clerk (`CHM_AUTH_PROVIDER=clerk`)

| Variable | Default | Description |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | — | Clerk publishable key (`pk_...`). Build-time — must be set before `pnpm run build`. |
| `CLERK_SECRET_KEY` | — | Clerk secret key (`sk_...`). Runtime only. Never expose to the browser. |
| `CHM_CLERK_PUBLIC_READ` | `false` | When `true`, anonymous visitors can view read-only monitoring content; writes (AI agent, control actions, arbitrary SQL) still require sign-in. Runtime only. See [Clerk → Public read-only mode](/authentication/clerk#public-read-only-mode). |

### Reverse proxy (`CHM_AUTH_PROVIDER=proxy`)

Trust a reverse proxy that already authenticated the user. Either mechanism below can authenticate a request.

**Cloudflare Access JWT:**

| Variable | Default | Description |
|---|---|---|
| `CHM_CF_ACCESS_TEAM_DOMAIN` | — | Cloudflare Access team URL (`https://<team>.cloudflareaccess.com`). Enables `Cf-Access-Jwt-Assertion` JWT verification. |
| `CHM_CF_ACCESS_AUD` | — | Access application AUD tag the JWT must carry. |

**Trusted header (bare subject):**

| Variable | Default | Description |
|---|---|---|
| `CHM_PROXY_AUTH_SECRET` | — | Shared secret. When set, the identity header is honored only if this secret is also present (constant-time compare). Without it, the trusted-header mechanism is **disabled**. |
| `CHM_PROXY_SHARED_SECRET_HEADER` | `X-Chm-Proxy-Secret` | Header the proxy sends containing the shared secret. |
| `CHM_PROXY_AUTH_HEADER` | `X-Forwarded-User` | Header the proxy sends containing the authenticated user identity. |

> When `CHM_PROXY_AUTH_SECRET` is set, the identity header (`X-Forwarded-User` by default) is honored only when the request also carries a matching shared-secret header (constant-time compared). Without `CHM_PROXY_AUTH_SECRET`, the entire trusted-header mechanism is disabled and identity headers are ignored.

### Trusted reverse proxy (`CHM_AUTH_PROVIDER=trusted`)

Use when an upstream proxy (oauth2-proxy, Authelia, Traefik ForwardAuth, nginx auth-url) forwards the user's full identity as HTTP headers. Extracts a complete principal — name, email, avatar, groups, custom claims.

**Trust gate** — configure exactly one:

| Variable | Default | Description |
|---|---|---|
| `CHM_TRUSTED_AUTH_SECRET` | — | Shared secret (runtime secret). The proxy must send it in `CHM_TRUSTED_SHARED_SECRET_HEADER`. Constant-time compared. Recommended. |
| `CHM_TRUSTED_ALLOW_INSECURE` | `false` | When `true`, trusts headers with no secret check. Only safe when the service is unreachable except via the proxy (e.g. k8s ClusterIP). |
| `CHM_TRUSTED_SHARED_SECRET_HEADER` | `X-Chm-Proxy-Secret` | Header name carrying the shared secret. |

**Identity headers** — all optional; defaults match common proxy conventions:

| Variable | Default | Populates |
|---|---|---|
| `CHM_TRUSTED_USER_HEADER` | `X-Forwarded-User` | Subject / user id. Falls back to the email header. |
| `CHM_TRUSTED_EMAIL_HEADER` | `X-Forwarded-Email` | Email address. |
| `CHM_TRUSTED_NAME_HEADER` | `X-Forwarded-Preferred-Username` | Display name. |
| `CHM_TRUSTED_AVATAR_HEADER` | `X-Forwarded-Avatar` | Avatar URL. |
| `CHM_TRUSTED_GROUPS_HEADER` | `X-Forwarded-Groups` | Comma- or space-separated groups. |
| `CHM_TRUSTED_ROLE_HEADER` | `X-Forwarded-Role` | Single role; merged into the groups list. |
| `CHM_TRUSTED_CUSTOM_HEADERS` | — | Extra claims. Comma-separated `field:Header-Name` pairs, e.g. `team:X-Forwarded-Team`. |

**Access control:**

| Variable | Default | Description |
|---|---|---|
| `CHM_TRUSTED_ALLOWED_GROUPS` | — | Comma-separated group names. When set, users whose forwarded groups do not intersect are denied `403`. Case-insensitive. |

See [Trusted proxy](/authentication/trusted-proxy) for setup examples (oauth2-proxy + Dex + Traefik, nginx).

---

## AI Agent / LLM Provider

The agent uses an OpenAI-compatible API. Set `LLM_API_KEY` to enable it. Keep all LLM keys server-side — never prefix them with `VITE_`.

| Variable | Default | Description |
|---|---|---|
| `LLM_API_KEY` | — | Provider API key (fallback when no provider-specific key is set). |
| `LLM_API_BASE` | `https://openrouter.ai/api/v1` | OpenAI-compatible API base URL. |
| `LLM_MODEL` | `openrouter:openrouter/free` | Model identifier in `provider:modelId` form. |
| `LLM_EXTRA_MODELS` | — | Additional model picker entries. Format: `provider:modelId[|contextLength][|description]`, comma-separated. Providers: `openrouter`, `nvidia`, `anyrouter`. |

### Provider-specific keys

Provider-specific keys take priority over the generic `LLM_API_KEY` / `LLM_API_BASE`.

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key. |
| `OPENROUTER_API_BASE` | OpenRouter base URL. |
| `OPENROUTER_REFERER` | HTTP referer sent to OpenRouter (for rankings). |
| `OPENROUTER_APP_NAME` | App name sent to OpenRouter (for rankings). |
| `OPENROUTER_MODELS_API` | OpenRouter models list endpoint (default `https://openrouter.ai/api/v1/models`). |
| `NVIDIA_API_KEY` | NVIDIA NIM API key. |
| `NVIDIA_API_BASE` | NVIDIA NIM base URL. |
| `ANYROUTER_API_KEY` | AnyRouter API key. |
| `ANYROUTER_API_BASE` | AnyRouter base URL. |

### Agent behavior

| Variable | Default | Description |
|---|---|---|
| `AGENT_API_TOKEN` | — | Shared Bearer token for the agent API (`POST /api/v1/agent`). Accepted when `CHM_FEATURE_AGENT_ACCESS=authenticated`. |
| `AGENT_ENABLE_CONTROL_TOOLS` | `false` | Enable kill-query, optimize, and other write actions. Keep `false` unless users are trusted. |

See [AI Agent — Configuration](/ai-agent/configuration) for full details.

---

## Conversation Store

Agent conversations default to browser localStorage. Enable server-side persistence with `AGENT_CONVERSATION_PERSISTENCE=true`.

| Variable | Default | Description |
|---|---|---|
| `AGENT_CONVERSATION_PERSISTENCE` | `false` | Enable server-side conversation persistence. |
| `AGENT_CONVERSATION_STORE` | `auto` | Backend: `auto`, `agentstate`, `d1`, `durable-object`, `clickhouse`, `postgres`, `memory`, or `local`. |

**AgentState backend:**

| Variable | Default | Description |
|---|---|---|
| `AGENTSTATE_API_KEY` | — | AgentState API key. Must start with `as_live_`. |
| `AGENTSTATE_API_BASE` | `https://agentstate.app/api` | AgentState API base URL. |

**Cloudflare D1 backend:**

| Variable | Default | Description |
|---|---|---|
| `CHM_CLOUD_D1_DATABASE_ID` | — | Cloudflare D1 database UUID for the `CHM_CLOUD_D1` binding. |
| `AGENT_CHM_CLOUD_D1_DATABASE_ID` | — | Alias for `CHM_CLOUD_D1_DATABASE_ID`. |

**Cloudflare Durable Object backend:**

| Variable | Default | Description |
|---|---|---|
| `AGENT_CONVERSATIONS_DO_BINDING` | `AGENT_CONVERSATIONS_DO` | Durable Object binding name. |

**ClickHouse backend:**

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_AGENT_CONVERSATIONS_TABLE` | `${CLICKHOUSE_DATABASE}.agent_conversations` | ClickHouse table for conversation storage. In `auto` mode, ClickHouse is tried only when this is explicitly set. |
| `CLICKHOUSE_AGENT_CONVERSATIONS_AUTO_CREATE` | `true` | Create the table at runtime if it does not exist. |

**PostgreSQL backend:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. |
| `POSTGRES_URL` | Alternative PostgreSQL connection string. |
| `POSTGRES_PRISMA_URL` | Prisma-specific PostgreSQL connection string. |

See [Conversation History — Backends](/ai-agent/conversation-history/backends) for setup and fallback behavior.

---

## AI Insights Store

The AI Insights panel on `/overview` persists its findings through a pluggable store. It is additive opt-in and defaults to ClickHouse; the D1, Postgres, and AgentState backends reuse the conversation-store env above.

| Variable | Default | Description |
|---|---|---|
| `INSIGHTS_STORE_BACKEND` | `auto` | Backend: `auto`, `clickhouse`, `d1`, `postgres`, `agentstate`, or `memory`. `auto` and `clickhouse` both use the ClickHouse `monitoring_findings` table. `auto` never silently follows other env; a selected backend missing its prerequisite falls back to ClickHouse. |
| `INSIGHTS_D1` | — | Optional dedicated D1 binding for the `d1` backend. Falls back to `CHM_CLOUD_D1` when unset. |

`postgres` reuses `DATABASE_URL`; `agentstate` reuses `AGENTSTATE_API_KEY` (+ optional `AGENTSTATE_BASE_URL`).

See [AI Agent — AI Insights persistence](/ai-agent#ai-insights-persistence) for setup and fallback behavior. `GET /api/v1/insights/backend` reports the active backend.

---

## PeerDB Monitoring

Optional. Set `PEERDB_API_URL` to enable the PeerDB section (Mirrors and Peers) in the sidebar.

| Variable | Default | Description |
|---|---|---|
| `PEERDB_API_URL` | — | PeerDB REST API base URL. For the PeerDB UI (NextAuth), include `/api` suffix — e.g. `https://peerdb.example.com/api`. For the raw flow-api, use the bare origin — e.g. `http://localhost:8113`. |
| `PEERDB_PASSWORD` | — | PeerDB password. Sent as HTTP Basic with an empty username. Server-side only. |
| `PEERDB_CACHE_TTL_MS` | `10000` | Server-side response cache TTL in milliseconds. Set `0` to disable. |
| `PEERDB_CACHE_MAX_ENTRIES` | `500` | Max cached PeerDB responses before oldest are evicted. |
| `PEERDB_FETCH_TIMEOUT_MS` | `10000` | Upstream PeerDB request timeout in milliseconds. |

chmonitor proxies only a read-only allowlist of PeerDB endpoints; mutating operations (create/drop/pause, alert config) are rejected with `403`.

```bash
## PeerDB UI behind NextAuth
PEERDB_API_URL=https://peerdb.example.com/api
PEERDB_PASSWORD=your-peerdb-ui-password

## Raw flow-api (no auth)
PEERDB_API_URL=http://localhost:8113
```

---

## Analytics & Branding

All client-side, all build-time. `VITE_*` for TanStack app; `NEXT_PUBLIC_*` for legacy Next.js.

| Variable | Default | Description |
|---|---|---|
| `VITE_TITLE_SHORT` | `ClickHouse` | Browser tab title (short form). |
| `VITE_LOGO` | — | Custom logo URL shown in the header. |
| `VITE_AUTOCOMPLETE_LIMIT` | — | Max results in autocomplete dropdowns. |
| `VITE_MEASUREMENT_ID` | — | Google Analytics measurement ID (`G-...`). |
| `VITE_SELINE_ENABLED` | `false` | Enable Seline analytics. |
| `VITE_VERCEL_ANALYTICS` | `false` | Enable Vercel Analytics. |
| `VITE_POSTHOG_KEY` | — | PostHog project API key. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog ingest host URL. |

---

## Runtime & Build

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment: `development`, `production`, `test`. |
| `ENABLE_CLOUDFLARE` | `false` | Enable Cloudflare-specific build configuration. |
| `CLOUDFLARE_WORKERS` | — | Set to `1` when running on Cloudflare Workers. |
| `CF_PAGES` | — | Set automatically by Cloudflare Pages at runtime. |
| `MINIFLARE` | — | Set to `1` when running locally with Miniflare. |
| `DOCS_CONTENT_ROOT` | — | Override docs content source directory. |

### Build-time only

Injected at build time for the About page.

| Variable | Description |
|---|---|
| `VITE_GIT_SHA` | Current commit SHA. |
| `VITE_GIT_REF` | Current git branch or tag. |
| `VITE_BUILD_TIMESTAMP` | ISO build timestamp. |
| `VITE_CI` | Set to `true` in CI environments. |

---

## Legacy / Migration

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_AUTH_PROVIDER` | Renamed to `VITE_AUTH_PROVIDER` in v0.3. Old name still works as a fallback. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Renamed to `VITE_CLERK_PUBLISHABLE_KEY` in v0.3. |
| `NEXT_PUBLIC_FEATURE_CONVERSATION_DB` | Deprecated alias for `AGENT_CONVERSATION_PERSISTENCE=true`. |
| `NEXT_PUBLIC_AUTOCOMPLETE_LIMIT` | Renamed to `VITE_AUTOCOMPLETE_LIMIT` in v0.3. |
| `NEXT_PUBLIC_RUNNING_QUERIES_REFRESH_MS` | Renamed to `VITE_RUNNING_QUERIES_REFRESH_MS` in v0.3. |
| `CLICKHOUSE_EXCLUDE_USER_DEFAULT` | Comma-separated usernames excluded from history-queries by default. |

See [Migrate to v0.3](/migrating/v0-3) for the full rename list.
