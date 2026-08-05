---
title: "5 min of ClickHouse: ch-ui — a lightweight ClickHouse dashboard"
description: "What ch-ui is, how to run it with Docker, what it shows, and when a full monitoring tool like chmonitor is the better choice."
date: 2026-08-05
tag: 5 min of ClickHouse
---

ch-ui is a lightweight web UI for ClickHouse. It gives you a table browser, a query editor, and query history — enough for ad-hoc exploration without a full monitoring setup. This post covers what it does, how to run it, and where it fits alongside chmonitor.

## What ch-ui is

ch-ui (also referenced as `altinity-clickhouse-web` or `clickhouse-web` in some distributions) is an open-source browser-based interface for ClickHouse. It's not a monitoring tool — it's a development and exploration tool.

**What it gives you:**
- Query editor with result table view
- Table browser with column types and row counts
- Query history per session

**What it doesn't give you:**
- Historical metrics over time
- Merge tracking
- Replication monitoring
- Multi-host dashboards
- Alerts

## Running with Docker

```bash
docker run -d \
  --name ch-ui \
  -p 8124:8123 \
  -e CLICKHOUSE_HOST=your-clickhouse-host \
  -e CLICKHOUSE_PORT=8123 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=your-password \
  ghcr.io/altinity/clickhouse-web:latest
```

Open `http://localhost:8124` and you're in the query editor.

## When ch-ui is the right tool

- Ad-hoc SQL exploration against a dev/test cluster
- Quick schema inspection (what columns does this table have?)
- Running one-off diagnostic queries without SSH
- Sharing a query result with a teammate via browser

## When you need more

As soon as you need to know:
- Is replication lagging right now?
- Which query consumed the most memory yesterday?
- How many parts does this table have, and is merge activity healthy?
- What does query latency look like over the last 24 hours?

…you need a monitoring tool. ch-ui shows you the current state of a query result, not trends over time.

## ch-ui + chmonitor together

They complement each other well:

- **ch-ui**: ad-hoc queries, schema exploration, quick debugging
- **chmonitor**: historical metrics, merge tracking, replication monitoring, slow query ranking, multi-host overview

chmonitor gives you the time-series view that ch-ui doesn't. ch-ui gives you the SQL scratchpad that chmonitor doesn't.

## How chmonitor complements this

chmonitor's [Queries](https://docs.chmonitor.dev/guide/features/queries) page ranks queries by execution time and memory usage over time — the view ch-ui doesn't provide. The [Health](https://docs.chmonitor.dev/guide/features/health) page tracks replication, merges, and disk in a single grid for every host. The AI agent can run the same diagnostic queries you'd type into ch-ui, but across all hosts in your cluster.

## Related

- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries)
- Docs: [Health page](https://docs.chmonitor.dev/guide/features/health)
- Docs: [Docker deployment](https://docs.chmonitor.dev/operate/deploy/docker)
- Next in the series: [The two kinds of ClickHouse indexes](/clickhouse-indexes-guide/)
