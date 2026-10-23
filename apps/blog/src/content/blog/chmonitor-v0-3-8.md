---
title: "chmonitor v0.3.8 — Find what nobody reads"
description: "The advisor finds unread tables, unread columns and unused projections, a read-only detached parts triage, hot query shapes for one table, new insights, and repeat reminders that know when to stop."
date: 2026-10-22
tag: Release
version: v0.3.8
author: duyetbot
cover: /posts/v0.3.8/cover.webp
---

chmonitor **v0.3.8** ships **45 new features, 106 fixes, and 6 performance
changes** since v0.3.7. The advisor finds data nobody reads, detached parts get
a careful triage, storage shows which queries hit a table, and alert reminders
are quieter.

<figure class="video">
  <video src="/posts/v0.3.8/launch.mp4" poster="/posts/v0.3.8/poster.webp" controls preload="metadata" playsinline></video>
  <figcaption>chmonitor v0.3.8 launch film. Unread data, detached parts triage, hot query shapes, insights and quieter reminders. Table names and numbers in the panels are illustrative.</figcaption>
</figure>

## What's new in v0.3.8

<div class="hl-grid wide">
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><path d="m3 3 18 18"/></svg></span><b>Unread data</b><span>Unread tables, unread columns, and unused projections, as an insight and an agent tool.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg></span><b>Detached parts triage</b><span>A read-only view and agent tool that sorts detached parts into review classes.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16h3"/><path d="M7 12h8"/><path d="M7 8h12"/></svg></span><b>Hot query shapes</b><span>For one table: which query shapes hit it, how often, and how many bytes they read.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/></svg></span><b>New insights</b><span>Repeated OPTIMIZE, heavy TTL merges, a retention forecast, and codec checks.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/></svg></span><b>Quieter reminders</b><span>Per-rule cooldown and mute, per-severity repeat, and back-off while a value stays flat.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span><b>New alert rules</b><span>Failing dictionaries, stuck Distributed queues, near max_concurrent_queries, and disks that fill within 24h.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg></span><b>Runaway queries</b><span>A long or memory-heavy query pages only when the server is also critical.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg></span><b>Access matrix</b><span>Users and roles by database and table, with row policies and quotas.</span></div>
</div>

## Find what nobody reads

The advisor now looks at the query log window and reports **tables nobody
read**, **columns nobody read**, and **projections no query used**. Each one is
an insight on the overview and a storage view of its own, and the agent can ask
for the same list with a tool. The advisor also questions codecs that do not
match the data, and judges size savings from the measured compression ratio.

## Detached parts triage

Detached parts are easy to get wrong: some are still owned by ClickHouse, some
are broken, and some look covered but only on one replica. The new **detached
parts triage** view groups them by table and reason, and gives each group a
review class.

<img src="/posts/v0.3.8/detached-parts-triage.webp" alt="Isometric figure of a triage bench: a detached part on a carriage is measured against the active part of its partition, then sorted into four review trays" width="2000" height="1250" loading="lazy" />

- **cannot_drop_via_sql** — attaching, deleting, or tmp-fetch parts that
  ClickHouse still owns.
- **needs_attention** — broken, broken-on-start, unexpected, or noquorum
  parts. Coverage never makes these reviewable.
- **review_after_coverage_check** — ignored, clone, or covered-by-broken parts
  that sit inside an active part of the same partition, older than 30 days.
- **review** — everything else.

Coverage is checked on **this replica only**, so no class means "safe to
drop". The agent tool is read-only: it never writes a DROP or ATTACH command,
and the owner decides.

## Hot query shapes

Open a table in storage and the new **hot query shapes** view lists the
normalized queries that hit it, how often they ran, and how many bytes they read. It is the fastest way to
see who depends on a table before you change its sort key or drop it.

## Insights

New checks flag work that rewrites data without adding any:

- Tables optimized again and again with no new data.
- TTL merges that rewrite far more data than is ingested.
- A retention forecast for the table that dominates ingest.

Insight enrichment now caps its output tokens, and the sweep can skip the LLM
entirely.

## Alerts

Repeat reminders know when to stop. You can set a **cooldown and mute per
rule**, a **repeat interval per severity**, and an opt-in **back-off while a
value stays flat**. Reminders that barely moved are skipped, and the ones that
are sent show how long the alert has been open and how much the value changed.
Custom targets can be told to alert once until resolved, with one-line digest
reminders.

Alerts now carry the deployment name, a dashboard link, and metadata, and
Matrix hookshot is a new webhook format. Alerts can also go to a **Matrix or
Element room natively**, and each sweep sends one grouped message per room.

Every channel now shows **the same alert facts**: severity, value,
thresholds, status, runbook, dashboard link, and the same RESOLVED wording. A
recovery says how long the alert fired. Before this, Matrix and hookshot
dropped thresholds and runbooks, and some digests had no dashboard link.

Webhooks are harder to misuse. A saved webhook or ntfy URL is **checked again
on every send**, not only when you save it. The webhook proxy and the
healthchecks pings **refuse redirects**, so a target cannot bounce a request to
a host the check did not allow. New built-in rules cover dictionaries
that fail to load, stuck Distributed send queues, running queries near
`max_concurrent_queries`, and disks that will fill within 24 hours.

## Runaway queries page only when the server hurts

A slow query on a healthy server is not an emergency. Two new signals watch for
runaway queries: **long-running queries** (warning at 10 minutes, critical at
1 hour) and **heavy query memory** (the heaviest query as a share of the server
memory limit, warning at 30%, critical at 50%). Both show on the health page,
and neither sends a message on its own.

The new **runaway-query-impact** rule pages only when one of those signals is
at least warning **and** `memory-pressure` or `concurrent-queries` is critical.
The page names the offending queries. Its remediation is read-only diagnostic
SQL. There is no kill button.

The figure below is that rule as a machine. The left gauge is the heaviest
query, the right gauge is server memory pressure. Each carriage pulls its bolt
when it passes its stop. The hammer rings the bell only when both bolts are out.

<figure class="video">
  <iframe src="/posts/v0.3.8/runaway-interlock.html" title="Runaway query interlock, an interactive figure" loading="lazy" style="aspect-ratio:1296/768;background:transparent"></iframe>
  <figcaption>Interactive: move the pointer across the figure to set the query gauge, and up or down to set the server gauge. Arrow keys work too. The thresholds are the rule defaults.</figcaption>
</figure>

<figure class="video">
  <video src="/posts/v0.3.8/runaway-interlock.mp4" poster="/posts/v0.3.8/runaway-interlock-poster.webp" controls muted loop preload="metadata" playsinline></video>
  <figcaption>The interlock in four states: both quiet, a heavy query on a healthy server, a busy server with small queries, and both at once, which pages. The gauge values are illustrative.</figcaption>
</figure>

## Who can read what, and who uses the server

The new **access matrix** under Security shows users or roles against
databases, and expands to tables. Each cell reads none, read, write, or admin,
and marks access that comes through a role, a partial revoke, or a readonly
cap. Open a cell for a sheet that lists each privilege and where it comes
from, plus the **row policies** and **quotas** that apply.

The new **usage by user** page under Queries lists one row per user over the
query log window, including inactive users, with a name filter and a preset to
hide system users. Open a user for a detail page: KPI tiles for queries,
failed share, p95 duration and bytes read, a yearly activity calendar, a
weekday by hour heatmap, top tables, top query shapes, errors, and clients.
Both pages read this replica only.

## Also in this release

- The agent gained an `explain_clickhouse_symbol` docs lookup tool and a
  settings-audit skill, and PeerDB and Postgres tools turn on when they are
  configured and reachable.
- `scripts/verify-alerting.ts` runs every alert rule on a real ClickHouse and
  sends a real alert to every channel format, so you can check rules and
  delivery end to end.
- Large sidebar groups have collapsible subgroups.
- Charts pause auto-refresh when they scroll out of view.
- In cloud mode, more API routes require sign-in, and many query configs now
  run on older and newer ClickHouse versions.

## Upgrading

Pull the new image or redeploy. The detached parts review alert is opt-in, and
repeat-reminder back-off is off until you turn it on.

```bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.8
```

On Kubernetes, Helm chart 0.2.18 ships with this release. It carries the
alert changes above: the deployment name and dashboard link in alerts, the
Matrix hookshot format, grouped hookshot and Matrix alerts per sweep, and
once-until-resolved custom targets.

```bash
helm repo update
helm upgrade my-chm chmonitor/chmonitor --version 0.2.18
```

## Read more

- [chmonitor v0.3.7](/v0.3.7/) — an agent that reads your page
- [Deploy chmonitor on Kubernetes with Helm](/self-hosting-chmonitor-helm/)
- [AI agent docs](https://docs.chmonitor.dev/guide/ai-agent)
- [GitHub release v0.3.8](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.8)
