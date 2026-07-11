---
title: "AI Insights: your cluster's problems, before you go looking"
description: "chmonitor's AI Insights engine watches your ClickHouse cluster and surfaces critical findings — read-only replicas, detached parts, replication lag — on the overview and in the header panel."
date: 2026-07-11
tag: Feature
---

Most monitoring tells you what you asked about. **AI Insights** tells you what
you didn't think to ask: chmonitor periodically inspects your cluster's system
tables, turns anomalies into short, severity-ranked findings, and puts them
where you'll actually see them.

<img src="/assets/screenshots/cluster-insights-dark-with-bg.jpeg" alt="chmonitor Overview with the AI Insights strip: critical and warning findings — read-only replicas, detached parts, replication lag — beside live cluster vitals" width="1600" height="658" loading="lazy" decoding="async" />

## Findings, not dashboards

Each finding is a concrete observation with a severity and a next step —
"2 replicas are read-only", "26,422 detached parts need review", "replication
is lagging", "this table's compression codec is underperforming" — linked
straight to the page where you'd act on it (replicas, tables, merges).

Findings have **stable keys**: dismiss one and it stays dismissed until the
underlying condition actually changes, so the strip doesn't nag you about the
thing you already triaged.

## In the header, on every page

You don't have to be on the overview to catch a new critical finding. The AI
Insights panel in the header shows the badge count and the latest findings from
any page of the dashboard:

<img src="/assets/screenshots/notify-getting-insights.png" alt="The AI Insights header panel listing new findings with severity icons" width="1264" height="1328" loading="lazy" decoding="async" />

Insights are generated on a schedule (cron) and on demand — hit Refresh in the
panel to re-inspect right now.

## Where it runs

AI Insights works on chmonitor Cloud and self-hosted alike. Findings persist
through a pluggable store (ClickHouse by default; D1, Postgres, or AgentState
via one env var) — see the [AI agent docs](https://docs.chmonitor.dev/guide/ai-agent#ai-insights-persistence)
for configuration.

*Related: [Cluster insights and record breakers in v0.3](/blog/chmonitor-v0-3), and
the [AI agent](https://docs.chmonitor.dev/guide/ai-agent) that powers ad-hoc
questions.*
