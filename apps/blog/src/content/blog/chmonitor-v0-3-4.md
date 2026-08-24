---
title: "chmonitor v0.3.4 — Tools, Schema Compare, workspace roles"
description: "After four days of agents working day and night — 106 PRs, 267 comments — v0.3.4 is the tag for Tools, workspace roles, Schema Compare, and the shift to self-hosted licenses."
date: 2026-08-20
tag: Release
version: v0.3.4
cover: /assets/screenshots/tools-advisor-dark.jpeg
---

After **four days** of agents working day and night — **106 pull requests** and
**267 comments** on GitHub — **v0.3.4** is the tag for everything that landed
on `main` after v0.3.3. The dashboard got a Tools menu, per-browser workspace
roles, Schema Compare, Settings Diff, a TTL inventory, and a What's new
dialog. We also dropped Cloud seats for a self-hosted license.

Every path below opens the live demo on
[dash.chmonitor.dev](https://dash.chmonitor.dev).

<div class="hl-grid">
  <div class="hl"><b>Tools menu</b><span>Interactive work — SQL, Explorer, Explain, Advisor, compare — now lives at the end of Main.</span></div>
  <div class="hl"><b>Workspace roles</b><span>Full, DBA, Engineer, or SRE. Hide and pin pages in this browser only.</span></div>
  <div class="hl"><b>Schema Compare</b><span>Diff table DDL across hosts or replica nodes. Copy the plan; nothing is applied.</span></div>
  <div class="hl"><b>Settings Diff</b><span>Compare system.settings and merge_tree_settings. All matched when nothing differs.</span></div>
  <div class="hl"><b>TTL inventory</b><span>Every MergeTree table's TTL and PARTITION BY, including tables with no TTL yet.</span></div>
  <div class="hl"><b>Licenses</b><span>We transformed the SaaS Cloud seat model to a self-hosted host-count license.</span></div>
</div>

## What shipped

### Tools and workspace

<div class="img-row" data-cols="2">
  <img src="/assets/screenshots/tools-advisor-dark.jpeg" alt="Tools menu open on Advisor — Schema & Settings with a table tree and copyable TTL advice" width="1600" height="949" loading="eager" />
  <img src="/assets/screenshots/settings-navigation-dark.jpeg" alt="Settings Navigation: Full, DBA, Engineer, SRE, or Custom workspace roles" width="1600" height="1228" loading="eager" />
</div>

SQL Console, Explorer, and Explain used to sit under Queries, Tables, and
Operations. They now live together in **Tools**, the last group in Main:
[SQL Console](https://dash.chmonitor.dev/sql),
[Data Explorer](https://dash.chmonitor.dev/explorer),
[Explain](https://dash.chmonitor.dev/explain),
[Advisor](https://dash.chmonitor.dev/advisor),
[Chart Builder](https://dash.chmonitor.dev/dashboard),
[Schema Compare](https://dash.chmonitor.dev/schema-diff), and
[Settings Diff](https://dash.chmonitor.dev/settings-diff). AI Agent stays its
own group. Postgres hosts do not see Tools at all.

The sidebar can follow the job, not the whole product. In Settings, pick
**Full**, **DBA**, **Engineer**, or **SRE** and the Navigation tree remounts
collapsed so you can scan groups instead of a wall of checkboxes. Hover
**Hide** next to Pin on a leaf; an undo toast appears, and restore always
lives in Settings → Workspace → Navigation. The longer argument is
[A DBA, an SRE, and an engineer should not share a sidebar](/customize-dashboard/).

### Schema Compare and Settings Diff

<img src="/assets/screenshots/chm-schema-compare.png" alt="Schema Compare empty state with a sample DDL pair — Need two saved connections, plus example tables analytics.sessions vs Host B" width="1600" height="1000" loading="lazy" />

[DBA workflows](https://docs.chmonitor.dev/guide/guides/dba-workflows) is the
map of what these pages do today.

[Schema Compare](https://dash.chmonitor.dev/schema-diff) diffs `CREATE TABLE`
across saved connections, or node vs node on this cluster. One host is not
enough — add a second, or compare replicas. The change plan is copy-only; it
never applies DDL. [Settings Diff](https://dash.chmonitor.dev/settings-diff)
does the same for `system.settings` and `system.merge_tree_settings`. Filter
to rows that differ, or to values changed from default. When every setting
matches, the page says **All matched**.

[Advisor](https://dash.chmonitor.dev/advisor) can emit a local statement plus
an `ON CLUSTER` variant when it knows the topology. Same rule: recommend
only.

### Cluster ops

[TTL and partition health](https://dash.chmonitor.dev/ttl-partition-health)
lists every MergeTree table's TTL and `PARTITION BY`, with partition and part
counts. Tables without TTL still appear. The page does not run `ALTER TTL` or
`DROP PARTITION`. Explorer table Overview now runs the same recommend-only
schema lint as Advisor.

Next to Settings, a newspaper icon opens **What's new** — notes from
`docs/whats-new/` for each tagged version, newest first. It auto-opens once
after an upgrade.

### Agent

On Cloud, [guests can chat](https://dash.chmonitor.dev/agents) with the agent
(still under the v0.3.3 guest cap). Keyless Firecrawl MCP is connected by
default (`CHM_AGENT_FIRECRAWL_MCP`; opt out if you do not want it). Follow-up
suggestions sit on the composer and know which tools just ran. Messages, tool
cards, and markdown are tighter, and the tool loop stops at 16 steps.

### Licenses

We transformed our SaaS Cloud seat model to a **self-hosted host-count
license**. The full argument is
[We're selling self-hosted licenses](/self-hosted-licenses/).

## Upgrade

Self-hosters: pin this tag and follow the guide you already use.

```bash
docker pull ghcr.io/chmonitor/chmonitor:v0.3.4
```

[Docker](https://docs.chmonitor.dev/operate/deploy/docker) is the fastest
path. On a cluster, use the [Kubernetes](https://docs.chmonitor.dev/operate/deploy/k8s)
chart. Edge deploys go through
[Cloudflare Workers](https://docs.chmonitor.dev/operate/deploy/cloudflare) or
[Vercel](https://docs.chmonitor.dev/operate/deploy/vercel). A bare VM can run
the [Node / standalone](https://docs.chmonitor.dev/operate/deploy/self-host)
build, optionally behind [Traefik](https://docs.chmonitor.dev/operate/deploy/traefik).
There is a [one-click](https://docs.chmonitor.dev/operate/deploy/one-click)
starting point, and a
[production checklist](https://docs.chmonitor.dev/operate/deploy/production-checklist)
before you expose the instance. The index for all of that is
[Deploy](https://docs.chmonitor.dev/operate/deploy).

Cloud ([dash.chmonitor.dev](https://dash.chmonitor.dev)) already has this
release. Nothing to migrate.

The full changelog is in the
[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.4).
