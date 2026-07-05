---
title: "Conversation store backends"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/ai-agent/conversation-history/backends.mdx"
---

Configure `AGENT_CONVERSATION_STORE` to one of the values below. All stores require `AGENT_CONVERSATION_PERSISTENCE=true`.

## Platform recommendation

| Platform | Recommended store | Why |
|---|---|---|
| Cloudflare Workers | `d1` | Managed SQL, easy to inspect/migrate/export |
| Cloudflare Workers (per-user isolation) | `durable-object` | Strictly colocated per-user state |
| Docker / self-hosted | `clickhouse` or `postgres` | Reuse existing infrastructure |
| Kubernetes | `postgres` | Standard managed database pattern |
| Vercel | `postgres` | Works with Vercel Postgres or any external PG |
| Local development | `local` or `memory` | No setup; data is ephemeral |

## `auto` — automatic selection

`auto` picks the first available backend in this order:

1. **AgentState** — when `AGENTSTATE_API_KEY` is set
2. **D1** — when the `CHM_CLOUD_D1` binding is present
3. **Durable Object** — when the `AGENT_CONVERSATIONS_DO` binding is present
4. **Postgres** — when `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRES_PRISMA_URL` is set
5. **ClickHouse** — only when `CLICKHOUSE_AGENT_CONVERSATIONS_TABLE` is explicitly set
6. **Memory** — in development/test only

In production, `auto` fails closed when no persistent backend is configured (does not silently fall through to memory).

## AgentState

Cloud-hosted conversation store. Requires an `as_live_` prefixed key.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=agentstate
AGENTSTATE_API_KEY=as_live_xxx
AGENTSTATE_API_BASE=https://agentstate.app/api
```

## Cloudflare D1

Cloudflare-only. Requires a provisioned D1 database and a Worker binding.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=d1
CHM_CLOUD_D1_DATABASE_ID=<uuid>
```

Provision and migrate:

```bash
pnpm run cf:setup-conversations
pnpm run cf:migrate-conversations
```

The setup script creates the D1 database, stores the UUID in `wrangler.toml`, and adds the `CHM_CLOUD_D1` binding. The migration script applies the schema. During CI deploys, set `CHM_CLOUD_D1_DATABASE_ID` as a secret so `wrangler deploy` includes the binding. Without it, the binding is excluded from the deploy.

Also accepts `AGENT_CHM_CLOUD_D1_DATABASE_ID` as an alias for `CHM_CLOUD_D1_DATABASE_ID`.

**When to use:** standard Cloudflare deployments that want queryable, exportable conversation history.

## Durable Object

Cloudflare-only. Each user gets one Durable Object backed by SQLite.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=durable-object
AGENT_CONVERSATIONS_DO_BINDING=AGENT_CONVERSATIONS_DO
```

`AGENT_CONVERSATIONS_DO_BINDING` defaults to `AGENT_CONVERSATIONS_DO`; only set it to override. No migration step — the schema is created automatically inside the object.

**When to use:** strictly colocated per-user state, or when you need transactional consistency within a user's history. For queryable history prefer D1.

## ClickHouse

Uses the same ClickHouse cluster the dashboard already connects to.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=clickhouse
CLICKHOUSE_AGENT_CONVERSATIONS_TABLE=system.agent_conversations
CLICKHOUSE_AGENT_CONVERSATIONS_AUTO_CREATE=true
```

`CLICKHOUSE_AGENT_CONVERSATIONS_TABLE` defaults to `${CLICKHOUSE_DATABASE}.agent_conversations`. Set it explicitly to include ClickHouse in `auto` resolution. With `CLICKHOUSE_AGENT_CONVERSATIONS_AUTO_CREATE=true` the table is created on first write (requires `CREATE TABLE` privilege). The ClickHouse user needs `INSERT` and `SELECT` on the conversation table.

The table uses `ReplacingMergeTree` with async inserts. Deletes are tombstone rows.

**When to use:** Docker or self-hosted deployments that already run ClickHouse and want to avoid a second database.

## Postgres

Any PostgreSQL-compatible database.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=postgres
DATABASE_URL=postgresql://user:password@host:5432/db
```

Also accepts `POSTGRES_URL` or `POSTGRES_PRISMA_URL` instead of `DATABASE_URL`. The runtime creates the `conversations` table and indexes if they do not exist. The database user needs `CREATE TABLE`, `CREATE INDEX`, `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the target schema.

**When to use:** Kubernetes, Vercel, or any deployment with an existing Postgres instance.

## Memory

Ephemeral in-process store. Lost on process restart.

```bash
AGENT_CONVERSATION_PERSISTENCE=true
AGENT_CONVERSATION_STORE=memory
```

Use only in development or tests. Not accepted as production persistent storage.

## Local (browser)

Default when persistence is off. No server config needed.

```bash
AGENT_CONVERSATION_STORE=local
```

History is stored in browser localStorage. Clearing browser data loses history. Unauthenticated sessions always use this backend even when server persistence is on.

## Deprecated alias

`NEXT_PUBLIC_FEATURE_CONVERSATION_DB=true` is equivalent to `AGENT_CONVERSATION_PERSISTENCE=true` but is deprecated. Do not use it for new deployments.
