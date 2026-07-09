# awesome-clickhouse submission (M4)

> Source: 2026-H2 market research, task **M4** in
> [`05-implementation-tasks.md`](./05-implementation-tasks.md). This doc holds the
> exact text for a manual PR against
> [korchasa/awesome-clickhouse](https://github.com/korchasa/awesome-clickhouse) —
> the agent that prepared this does not open PRs on external repos, so the
> maintainer submits it by hand.

## Finding: this is an update, not a new entry

`awesome-clickhouse` already lists this project — under its pre-rebrand name —
in the **`## Ops`** section of `README.md`:

```markdown
- [duyet/clickhouse-monitoring](https://github.com/duyet/clickhouse-monitoring) (246 TypeScript) - ClickHouse Monitoring Dashboard is a Next.js-based UI tool that leverages system tables to provide comprehensive monitoring and visualization of ClickHouse clusters, including query, cluster, and table metrics.
```

`duyet/clickhouse-monitoring` is a GitHub-transferred redirect to
`chmonitor/chmonitor` (confirmed via `gh api repos/duyet/clickhouse-monitoring`
→ `full_name: chmonitor/chmonitor`, same 246 stars). The entry is stale in three
ways: the URL/owner (pre-transfer), the tech stack (Next.js → TanStack Start as
of v0.3), and the positioning (a "monitoring UI" description undersells the AI
advisor + MCP server the project has since grown). **The correct submission is
to update this entry in place**, not add a duplicate — the target repo's README
says the list is "automatically compiled," so a duplicate would likely get
deduped or flagged in review anyway.

Do not also add a second entry under `### Metrics and Monitoring` (Integrations)
— `Ops` is the right single home; it already sits next to
`ClickHouse/mcp-clickhouse`, which is the right neighbor given chmonitor ships
its own MCP server.

## Exact diff

File: `README.md`, section `## Ops` (the entry also moves one line up —
alphabetical order sorts `chmonitor` before `ClickHouse/mcp-clickhouse`):

```diff
 ## Ops

 - [Altinity/clickhouse-backup](https://github.com/Altinity/clickhouse-backup) (1622 Go) - Altinity/clickhouse-backup is a tool for easy backup and restore of ClickHouse databases using various cloud and local object storage systems.
+- [chmonitor/chmonitor](https://github.com/chmonitor/chmonitor) (246 TypeScript) - chmonitor (formerly clickhouse-monitoring) is an open-source operational advisor for ClickHouse that reads system.* tables to recommend projections, skip indexes, partition keys and materialized views — recommend-only, never auto-applies DDL — alongside real-time query, cluster and replication monitoring, an AI chat agent, and an MCP server. Self-host free (GPL-3.0) or use the hosted Cloud.
 - [ClickHouse/mcp-clickhouse](https://github.com/ClickHouse/mcp-clickhouse) (673 Python) - ClickHouse MCP Server is a secure MCP server enabling read-only SQL query execution and database management operations on ClickHouse clusters.
-- [duyet/clickhouse-monitoring](https://github.com/duyet/clickhouse-monitoring) (246 TypeScript) - ClickHouse Monitoring Dashboard is a Next.js-based UI tool that leverages system tables to provide comprehensive monitoring and visualization of ClickHouse clusters, including query, cluster, and table metrics.
 - [PostHog/HouseWatch](https://github.com/PostHog/HouseWatch) (619 TypeScript) - HouseWatch is an open-source tool by PostHog for monitoring and managing ClickHouse clusters, providing detailed insights into query performance, cluster load, logs, and disk usage with operational controls.
```

Star count (246) and language (TypeScript) were pulled live via
`gh api repos/chmonitor/chmonitor` on 2026-07-10 — re-check before submitting
in case the list's own compiler expects a fresher count, or drop the number
entirely and match whatever format the maintainer's bot currently emits.

## Suggested PR

- **Fork/branch:** `chmonitor-rebrand` (or similar) on a fork of
  `korchasa/awesome-clickhouse`.
- **Title:** `Update duyet/clickhouse-monitoring → chmonitor/chmonitor (repo renamed)`
- **Body:**

  ```markdown
  `duyet/clickhouse-monitoring` was transferred to the `chmonitor` GitHub org
  and renamed to `chmonitor/chmonitor` — the old URL 302s there already. This
  PR updates the Ops entry to the new URL, refreshes the description (the
  project has grown from a monitoring UI into an operational advisor that
  recommends projections/skip-indexes/partition keys/materialized views from
  `system.*`, plus an AI chat agent and MCP server), and re-sorts it
  alphabetically. No new entry added — this replaces the existing one in place.
  ```

## Follow-up: on-ramp from the old repo

The implementation task also calls for "a chmonitor on-ramp from
`duyet/clickhouse-monitoring`." Since that repo *is* `chmonitor/chmonitor`
post-transfer (same issues/stars/stars history, just renamed), visitors landing
on the old URL already arrive at the current README via GitHub's redirect —
this README rework (title, hero, OSS-vs-Cloud framing) *is* that on-ramp. No
separate redirect page or archived-repo README is needed.
