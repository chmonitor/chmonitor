---
title: "5 min of ClickHouse: what an AI agent can actually do with your ClickHouse data"
description: "AI agents for ClickHouse are not just chatbots — they're structured tools that can run queries, analyze patterns, and surface problems. Here's what's actually possible and where the line is."
date: 2026-08-05
tag: 5 min of ClickHouse
---

"AI agent for ClickHouse" is a phrase that covers a wide range of capabilities. Some agents are chat wrappers around a single query. Others are tool-calling systems that can inspect system tables, run queries, and take action. This post covers what's actually possible today and where the line is between useful and dangerous.

## What "AI agent" means in this context

An AI agent in the ClickHouse space is a system that:
1. Reads system tables (`query_log`, `merges`, `replicas`, etc.)
2. Runs diagnostic queries against your data
3. Analyzes the results and presents findings
4. Optionally takes action (with your confirmation)

The key word is **tool-calling**. The agent doesn't generate SQL and hope — it uses structured tools that validate inputs, handle errors, and return typed results. The MCP protocol is the transport layer for those tools.

## What the agent CAN do

- **Run diagnostic queries**: "show me the slowest queries in the last 6 hours"
- **Analyze query patterns**: "this query shape has been getting slower over the last week"
- **Suggest schema improvements**: "adding a skip index on this column would skip 80% of parts"
- **Check cluster health**: "replica X is readonly with queue_size = 45"
- **Explain errors**: "MEMORY_LIMIT_EXCEEDED here is caused by GROUP BY on a 2M distinct key"
- **Compare versions**: "your cluster is on 23.8, this feature requires 24.3"

## What the agent CANNOT do

- **Schema migrations without review**: an agent can suggest `ALTER TABLE`, but it shouldn't execute DDL on production without your approval
- **DELETE / DROP operations**: destructive operations require explicit confirmation
- **Production writes**: an agent monitoring read-only shouldn't insert data
- **Cross-cluster operations**: an agent scoped to one ClickHouse instance shouldn't act on another

## The MCP protocol briefly

MCP (Model Context Protocol) is a standard for exposing tools to AI models. In the ClickHouse context:

- Each system table query is a **tool** with a typed input (date range, table name, host)
- The model calls the tool, gets structured results back
- The model synthesizes those results into a human-readable answer

This matters because it means the agent isn't generating SQL from a prompt and hoping it parses — it's calling a validated function with known return types.

```json
{
  "tool": "query_slow_queries",
  "arguments": {
    "hostId": "production",
    "since": "6h",
    "min_elapsed": 1.0
  }
}
```

The tool returns typed results. The model explains them.

## When it's useful vs when manual SQL is better

**Agent is useful when:**
- You don't know the exact system table name or column
- You want a natural language summary of a complex diagnostic
- You're exploring across multiple system tables at once
- You want a repeatable diagnostic workflow ("every morning, check merge health")

**Manual SQL is better when:**
- You know exactly what you need and just need the data
- You're writing a one-off investigation query
- You need full control over the exact query plan and settings
- You're debugging a specific edge case the agent hasn't been trained on

## Setting one up

The MCP server for ClickHouse exposes tools for:
- Running queries against any configured host
- Reading system tables (query_log, merges, replicas, parts, etc.)
- Getting cluster metadata
- Checking version and configuration

The chmonitor agent connects to this via the built-in MCP endpoint. For standalone setups, the MCP server runs as a thin proxy that validates queries and returns results in a format the model can reason about.

## How chmonitor does this

chmonitor's AI agent has 20+ tools covering schema inspection, query execution, health checks, and optimization suggestions. It reads from the same system tables you would query manually, but it does so with typed inputs and structured outputs. The [AI Agent docs](https://docs.chmonitor.dev/guide/ai-agent) cover setup and configuration.

## Related

- Docs: [AI Agent setup](https://docs.chmonitor.dev/guide/ai-agent)
- Docs: [MCP Server](https://docs.chmonitor.dev/guide/guides/mcp-server)
- Previous in the series: [What to monitor in ClickHouse](/clickhouse-monitoring-101/)
