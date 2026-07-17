---
title: "Ask your ClickHouse cluster anything: the AI agent over MCP"
description: "How chmonitor's read-only AI agent turns natural-language questions into system-table queries, and how to reach it from Claude Desktop or Cursor over MCP."
date: 2026-07-10
tag: How-to
---

This is for anyone who has typed "why is my ClickHouse cluster slow right now" into a search bar instead of `system.query_log`. chmonitor ships a built-in AI agent that plans and runs the diagnostic queries for you — inside the dashboard, or from any MCP-compatible client. By the end you'll have it answering questions from both.

## Prerequisites

- A chmonitor instance already connected to a ClickHouse host.
- At least one LLM provider API key (`LLM_API_KEY` at minimum — chmonitor defaults to OpenRouter's free tier if that's all you set).
- For the MCP path: an MCP-compatible client (Claude Desktop, Cursor, etc).

## Steps

### 1. Set an LLM provider key

```bash
LLM_API_KEY=your-provider-key
```

That's the only required variable. Full provider/model options (AnyRouter, OpenRouter, NVIDIA NIM, custom base URLs) are in the [Configuration](https://docs.chmonitor.dev/guide/ai-agent/configuration) reference.

### 2. Ask it something in the dashboard

Open `/agents`, pick a host, and ask a question in plain English — "which tables have the most active merges right now", "am I about to run out of disk", "why did query X get slow". The agent plans a sequence of **read-only** tool calls against `system.*` tables and streams back an answer, with an inline chart when one helps.

Under the hood it has a lean, fixed toolset — no ability to invent arbitrary write queries. A few examples: `get_slow_queries` / `list_slow_query_patterns` read `system.query_log`; `get_replication_status` reads `system.replicas`; `get_merge_status` reads `system.merges`; `forecast_disk_capacity` and `suggest_ttl_adjustment` are recommend-only (they never execute anything); `get_optimization_recommendations` analyzes a slow query and returns ranked DDL suggestions for you to review, not apply.

For anything outside the built-in tools, the agent falls back to a plain `query` tool plus an expert **skill** — a bundled recipe with copy-pasteable SQL for a specific domain (replication, storage, cluster topology, incident response, and more).

### 3. Connect an external MCP client

chmonitor exposes the same agent surface as an MCP server at `/api/mcp`. Point Claude Desktop, Cursor, or any MCP client at it and it gets the same read-only tools the in-dashboard agent uses — so you can ask your cluster questions from your editor instead of switching tabs.

```json
{
  "mcpServers": {
    "chmonitor": {
      "url": "https://your-chmonitor-host/api/mcp"
    }
  }
}
```

Exact auth requirements (open, HMAC API key, or Clerk OAuth) depend on how you've configured the endpoint — see the [MCP server guide](https://docs.chmonitor.dev/guide/features/mcp) for the full setup and security posture.

## Verifying it worked

In the dashboard, ask "what's my slowest query in the last hour" and confirm you get back an answer referencing real `query_id`s and durations from your cluster, not a generic response. From an MCP client, list the available tools and confirm `get_replication_status`, `get_slow_queries`, or similar chmonitor-specific tools show up alongside whatever else the client has configured.

## Related

- Docs: [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — full tool list, skills, plan-and-verify mode.
- Docs: [AI agent capabilities](https://docs.chmonitor.dev/guide/ai-agent/capabilities) — every tool, grouped by category, with the exact `system.*` tables each one reads.
- Docs: [MCP server](https://docs.chmonitor.dev/guide/features/mcp) — endpoint setup, auth modes, security.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] Tool names (get_slow_queries, list_slow_query_patterns, get_replication_status, get_merge_status, forecast_disk_capacity, suggest_ttl_adjustment, get_optimization_recommendations) checked against apps/dashboard/src/lib/ai/agent/tools/*.ts and docs/content/guide/ai-agent/capabilities.mdx.
- [x] LLM_API_KEY quick-start and OpenRouter default checked against docs/content/guide/ai-agent.mdx.
- [x] MCP endpoint path /api/mcp and docs cross-link checked against docs/content/guide/features (mcp guide referenced in ai-agent.mdx).
- [x] Feature is merged to main (apps/dashboard/src/lib/ai/agent/*).
- [x] No self-hosted-vs-cloud scope issue — agent + MCP work on both, no Cloud-only claim made.
-->
