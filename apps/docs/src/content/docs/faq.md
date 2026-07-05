---
title: "FAQ"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/faq.mdx"
---

## Connection issues

**The dashboard shows a connection error.**

Check that `CLICKHOUSE_HOST` is a full URL including scheme and port, e.g. `http://your-host:8123` or `https://your-host:8443`. Inside Docker, `localhost` points at the container itself — use the ClickHouse service name on the Docker network, or `host.docker.internal` (Mac/Windows) / `172.17.0.1` (Linux) to reach a process on the Docker host.

**I changed ClickHouse credentials but the dashboard still fails.**

Restart or redeploy the app after updating credentials. For Cloudflare Workers, run `pnpm run cf:config` to push the new secrets, then redeploy (`pnpm run cf:deploy`). The worker connection pool caches credentials at startup.

## System tables and empty pages

**Some pages are empty or show "table not found".**

The page depends on a ClickHouse system table that is disabled or not present in your version. See [Enable system tables](/getting-started/clickhouse-enable-system-tables) to check which tables are required and how to enable them.

**The query thread analysis page is empty.**

`system.query_thread_log` must be explicitly enabled in ClickHouse config and `log_query_threads=1` must be set in the profile used by the monitoring user. See the [Enable system tables](/getting-started/clickhouse-enable-system-tables) guide.

**ZooKeeper / Keeper pages are missing.**

`system.zookeeper` only exists when ClickHouse Keeper or ZooKeeper is configured. If you don't use a replicated setup, these pages will not show data.

## Authentication

**How do I require login before anyone can use the dashboard?**

Set `CHM_AUTH_PROVIDER=clerk` and configure Clerk keys, then set `CHM_AUTH_REQUIRED_FEATURES=agent,mcp,settings,actions` (or use `CHM_FEATURE_{ID}_ACCESS=authenticated` per feature). See [Authentication](/authentication).

**I want to protect specific features but not the whole dashboard.**

Use per-feature env vars:

```bash
CHM_FEATURE_AGENT_ACCESS=authenticated
CHM_FEATURE_MCP_ACCESS=authenticated
```

**The AI agent is accessible without login. Is that safe?**

The agent uses the same ClickHouse grants as the configured monitoring user. If that user is read-only, the agent can only read. If you want to restrict it further, set `CHM_FEATURE_AGENT_ACCESS=authenticated`.

## Multi-host

**How do I monitor multiple ClickHouse clusters?**

Set `CLICKHOUSE_HOST` to a comma-separated list of host URLs. For credentials, you can provide a single value (applied to all hosts) or one value per host position. `CLICKHOUSE_NAME` is optional (hosts default to indexed labels):

```bash
CLICKHOUSE_HOST=https://prod-a:8443,https://prod-b:8443
CLICKHOUSE_USER=monitoring,monitoring
CLICKHOUSE_PASSWORD=secret-a,secret-b
CLICKHOUSE_NAME=prod-a,prod-b
```

A host selector appears in the UI when more than one host is configured.

## AI agent

**The agent returns errors or doesn't respond.**

Check that `LLM_API_KEY` is set and that `LLM_API_BASE` points at a reachable OpenAI-compatible endpoint. The agent uses `https://openrouter.ai/api/v1` by default. Verify the key works by testing the endpoint directly. Also confirm the feature is not disabled (`CHM_FEATURE_AGENT_ENABLED=false` would silence it).

**The agent can't kill queries or run OPTIMIZE.**

`AGENT_ENABLE_CONTROL_TOOLS` defaults to `false`. Set it to `true` only if you intend to let the agent use those actions, and only when the ClickHouse user has the corresponding grants (`KILL QUERY`, `OPTIMIZE`).

## Conversation persistence

**Agent conversation history disappears after I close the browser.**

By default, history lives in browser `localStorage`. To persist it server-side, set:

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=auto
```

Then configure a backend store (AgentState, D1, ClickHouse, Postgres). See [Store Backends](/ai-agent/conversation-history/backends).

## Data freshness

**The dashboard shows stale data.**

The app caches query results. Lower `NEXT_QUERY_CACHE_TTL` (default 3600 seconds) for fresher data at the cost of more ClickHouse queries. In the TanStack app, client-side SWR also revalidates on focus and on a polling interval.

## Deployment

**Which deployment should I use?**

- **Docker** — simplest self-hosted path, works anywhere Docker runs.
- **Kubernetes** — best when the dashboard is managed alongside your platform workloads.
- **Cloudflare Workers** — edge hosting, no server to operate, works well with Cloudflare Access for auth.
- **Vercel / self-host Node** — if you prefer a Node-based platform.

See [Install & Configure](/deploy) for platform-specific guides.
