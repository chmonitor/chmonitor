---
id: mcp-server
title: MCP Server
type: reference
status: active
updated: 2026-05-13
tags:
  - mcp
  - api
  - ai-tools
related:
  - query-config-format
  - deployment
---

# MCP Server

The chmonitor exposes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server at `/api/mcp`. Allows AI assistants to interact with ClickHouse clusters programmatically.

## Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `query` | Execute read-only SQL query | `sql` (string, required) |
| `list_databases` | List databases with engines and comments | `hostId` (number, optional) |
| `list_tables` | List tables with row counts and sizes | `database` (string, required) |
| `get_table_schema` | Show columns, types, defaults, comments | `database`, `table` (required) |
| `get_metrics` | Server version, uptime, active connections | `hostId` (number, optional) |
| `get_running_queries` | Currently executing queries by elapsed time | `hostId` (number, optional) |
| `get_slow_queries` | Slowest completed queries from query log | `limit` (number, optional) |
| `get_merge_status` | Running merge operations with progress | `hostId` (number, optional) |

## Setup

### Claude Desktop

```json
{
  "mcpServers": {
    "clickhouse-monitor": {
      "url": "https://your-deployment.example.com/api/mcp"
    }
  }
}
```

### Cursor

Settings > MCP > Add Server → endpoint URL

### Testing

```bash
curl -X POST https://your-deployment.example.com/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Security

- **Read-only**: All MCP tools execute read-only operations (`readonly: 1`)
- **Secure by default**: The `/api/mcp` endpoint returns 401 when no auth scheme is configured. Anonymous access requires an explicit operator opt-in via `CHM_MCP_PUBLIC=true`.
- **Query limits**: Same `CLICKHOUSE_MAX_EXECUTION_TIME` timeout as dashboard
- **No credential exposure**: Uses dashboard's configured ClickHouse credentials

### Auth modes (precedence order)

| Condition | Behaviour |
|-----------|-----------|
| `CHM_API_KEY_SECRET` or `CLERK_SECRET_KEY` set | Token required; 401 without a valid token |
| Neither secret set + `CHM_MCP_PUBLIC=true` | Open access; **warning logged on every request** |
| Neither secret set + no `CHM_MCP_PUBLIC` | **Deny (401)** — secure-by-default |

### Enabling open mode (trusted private networks only)

```bash
CHM_MCP_PUBLIC=true
```

A loud `console.warn` is emitted on each request when running in open mode so the
exposure is visible in logs and cannot be silently forgotten.

## Key Files

- `packages/mcp-server/src/http.ts` — auth gate (`defaultAuthenticator`)
- `packages/mcp-server/src/auth/` — api-key + Clerk OAuth verifiers
- Tests: `packages/mcp-server/src/__tests__/http.test.ts`

## Consuming external MCP servers (per-user registry)

The opposite direction: the in-app **agent** can also load tools from *external*
MCP servers a user registers. This is a **cloud (D1) feature**, strictly
per-user, and additive — self-hosted without D1 falls back to the browser
(`localStorage`) sidebar panel and stays whole.

- **Store / D1** — `apps/dashboard/src/lib/ai/agent/mcp/registration-store.ts`
  (table `mcp_server_registrations`, migration
  `db/conversations-migrations/0015_mcp_server_registrations.sql`). Every
  read/write is `WHERE user_id = ?`; owner-guarded upsert
  (`ON CONFLICT ... WHERE user_id = excluded.user_id`). Auth secrets encrypted at
  rest via `registry-crypto.ts` (AES-256-GCM, same key material as
  `connection-store/crypto.ts`), never returned by the API.
- **Connect / SSRF (SEC-04)** — `connect-custom-servers.ts`: `validateServer`
  (test-before-save, always closes the client) and `loadUserRegisteredServers`
  (best-effort, `[]` when no D1). The transport is **pinned behind
  `createHostValidationFetch()`** (same posture as `connection-query/
  connection-client.ts` for ClickHouse hosts) so the actual outbound connection
  is validated, not just a pre-check.
- **Agent wiring** — `routes/api/v1/agent.ts` merges request-body servers +
  D1 registrations (deduped by endpoint), connects once *below* the 402 billing
  gate, and closes on the pre-stream throw path.
- **Routes / UI** — `routes/api/v1/mcp/servers.ts` (CRUD) + `mcp/probe.ts`
  (test), `routes/(dashboard)/mcp-servers.tsx` +
  `components/mcp/mcp-server-manager.tsx` (manager with template library:
  Slack / GitHub / Datadog). See `docs/content/guide/ai-agent.mdx` §"Persistent
  MCP server registry".
