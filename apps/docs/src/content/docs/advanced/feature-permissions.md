---
title: "Feature Permissions"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/advanced/feature-permissions.mdx"
---

Feature permissions let you hide or protect specific dashboard sections without changing application code. Features are enabled and public by default — except the **AI agent** (`agent`) and **control actions** (`actions`), which default to `authenticated`. Configure only what needs different behavior.

Permissions also carry a **read / write** classification. Reads are predefined monitoring data; writes are the AI agent, control actions, and arbitrary SQL execution. Under `auth=clerk` with [`CHM_CLERK_PUBLIC_READ`](/authentication/clerk#public-read-only-mode), anonymous visitors may perform reads but never writes; with `auth=none` everyone may do both.

---

## Defaults

```text
enabled = true
access  = "public"   (alias: "guest")
```

A self-hosted deployment with no auth configured works out of the box. Every page is visible to any visitor.

---

## Access values

| Value | Behavior |
|---|---|
| `public` | Any visitor can see and use the feature. |
| `guest` | Alias for `public`. |
| `authenticated` | Requires a valid session. Accepted: Clerk browser session, `AGENT_API_TOKEN` Bearer (agent APIs), or `chm_` API key. |

v1 has no roles — only public and authenticated access levels.

---

## Configuration sources

Later sources win over earlier ones:

```
built-in allow-all defaults
  → TypeScript config defaults
    → CHM_CONFIG_FILE (TOML or YAML)
      → environment variables
```

---

## Config file (`CHM_CONFIG_FILE`)

Point `CHM_CONFIG_FILE` at a TOML or YAML file. Feature names are lowercase in the file.

**TOML:**

```toml
## /etc/clickhouse-monitor/config.toml

[features.agent]
enabled = true
access = "authenticated"

[features.metrics]
enabled = true
access = "guest"

[features.settings]
enabled = false
```

**YAML:**

```yaml
## /etc/clickhouse-monitor/config.yaml

features:
  agent:
    enabled: true
    access: authenticated
  metrics:
    enabled: true
    access: guest
  settings:
    enabled: false
```

---

## Environment variable overrides

Env vars override the config file. Feature ids are uppercase in env var names.

```bash
## Disable many features at once
CHM_DISABLED_FEATURES=settings,insights

## Require auth for many features at once
CHM_AUTH_REQUIRED_FEATURES=agent,settings

## Override one feature
CHM_FEATURE_AGENT_ACCESS=authenticated
CHM_FEATURE_METRICS_ENABLED=false
CHM_FEATURE_SETTINGS_ACCESS=authenticated
```

---

## Supported feature ids

Use these ids in TOML/YAML (lowercase) or env vars (uppercase):

| Feature id | Pages / areas |
|---|---|
| `overview` | `/overview` |
| `agent` | `/agents` (AI agent chat) |
| `insights` | `/insights` |
| `health` | `/health` |
| `queries` | `/running-queries`, `/history-queries`, `/failed-queries`, `/expensive-queries`, `/slow-queries`, `/explain`, and related |
| `tables` | `/tables`, `/explorer`, `/replicas`, `/dictionaries`, `/kafka-consumers`, and related |
| `operations` | `/merges`, `/mutations`, `/moves`, `/part-log`, and related |
| `metrics` | `/metrics`, `/asynchronous-metrics`, `/profiler`, and related |
| `dashboard` | `/dashboard` |
| `cluster` | `/cluster` (topology diagram) |
| `security` | `/security` |
| `logs` | `/logs` |
| `settings` | `/settings` |
| `mcp` | MCP server feature area |
| `docs` | `/docs` |
| `about` | `/about` |
| `peerdb` | PeerDB Mirrors and Peers section |
| `actions` | Row-level actions across data pages |

---

## Docker examples

**With config file:**

```bash
docker run -d \
  -e CLICKHOUSE_HOST='http://clickhouse:8123' \
  -e CLICKHOUSE_USER='default' \
  -e CLICKHOUSE_PASSWORD='' \
  -e CHM_CONFIG_FILE='/etc/clickhouse-monitor/config.toml' \
  -v "$PWD/config.toml:/etc/clickhouse-monitor/config.toml:ro" \
  -p 3000:3000 \
  ghcr.io/duyet/chmonitor:vX.Y.Z
```

**Env-only:**

```bash
docker run -d \
  -e CLICKHOUSE_HOST='http://clickhouse:8123' \
  -e CLICKHOUSE_USER='default' \
  -e CLICKHOUSE_PASSWORD='' \
  -e CHM_FEATURE_AGENT_ACCESS='authenticated' \
  -e CHM_FEATURE_SETTINGS_ENABLED='false' \
  -p 3000:3000 \
  ghcr.io/duyet/chmonitor:vX.Y.Z
```

---

## Authentication for `authenticated` features

Gating UI features with `access = "authenticated"` requires a user auth provider (for example, Clerk). Set one of:

**Clerk:**

```bash
CHM_AUTH_PROVIDER=clerk
VITE_AUTH_PROVIDER=clerk
VITE_CLERK_PUBLISHABLE_KEY=pk_live_your_key
CLERK_SECRET_KEY=sk_live_your_key
```

> `VITE_*` vars are build-time inlined — set them before running `pnpm run build`. See [Migrate to v0.3](/migrating/v0-3) if you are upgrading from the legacy Next.js app and need the old `NEXT_PUBLIC_*` names.

**Agent API token (agent API endpoints only — does not provide UI-level user authentication):**

```bash
AGENT_API_TOKEN=your-shared-token
```

```bash
## Call the agent API
curl -H "Authorization: Bearer your-shared-token" \
  https://your-deployment.example.com/api/v1/agent
```

See [Authentication](/authentication) for the full auth model, including API keys and reverse-proxy options.

---

## Common policies

**Gate AI agent behind login, keep everything else open:**

```toml
[features.agent]
access = "authenticated"
```

**Hide metrics completely:**

```toml
[features.metrics]
enabled = false
```

**Require login for settings:**

```toml
[features.settings]
access = "authenticated"
```

**Multiple env-var approach (no config file needed):**

```bash
CHM_FEATURE_AGENT_ACCESS=authenticated
CHM_FEATURE_SETTINGS_ACCESS=authenticated
CHM_DISABLED_FEATURES=insights
```

---

## Behavior when a feature is disabled or gated

- **Disabled** (`enabled = false`): removed from navigation and command search. Direct page visits show a disabled screen. API routes return a blocked response before querying ClickHouse or the agent.
- **Authenticated** (`access = "authenticated"`): unauthenticated visitors see the feature in navigation (so they know to sign in) but cannot load data. API routes reject unauthenticated requests.

---

## Related

- [Authentication](/authentication) — auth providers and API keys.
- [Environment Variables — Feature Permissions](/reference/environment-variables#feature-permissions) — full env var reference.
- [Features](/features) — what each feature does.
