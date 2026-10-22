# Tool routing

A user asks a monitoring question in plain words. The agent answers by calling
the dedicated read-only tool for it, not by guessing and not by hand-writing
SQL when a primitive exists.

## Sub-features

- `route-health` covers disk, metrics and replication questions, which should
  reach `get_disk_usage`, `get_metrics` or `get_replication_status`.
- `route-schema` covers database, table and column questions, which should
  reach `list_databases`, `list_tables` or `get_table_schema`.
- `route-queries` covers running, failed and slow query questions, which
  should reach `get_running_queries`, `get_failed_queries` or
  `list_slow_query_patterns`.
- `route-sql` covers an explicit SQL request, which should reach `query`.

## How to get to it (user POV)

- Open the agent panel in the dashboard and type the question.
- Or call `POST /api/v1/agent` directly, the same endpoint the panel uses.

## Driving it with ask-agent

Preconditions:

- The Doctor check has run and you have noted its status.

Steps:

- **Health route.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — disk free space"`.
  `verdict.json` should show `called` containing `get_disk_usage` (or
  `query`) and exit 0.
- **Schema route.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — columns of a table"`.
  `called` should contain `get_table_schema`, `explore_table_schema` or
  `query`.
- **Query route.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — errors today"`.
  `called` should contain `get_failed_queries` or `query`.

## Gotchas

- On a 503 Doctor result, every data tool returns `[tool-error:…1033…]`. The
  routing is still proved, but the answer text is an apology. Do not grade the
  answer.
- The free model sometimes answers from memory with no tool. Rerun once
  before you call it a regression.
