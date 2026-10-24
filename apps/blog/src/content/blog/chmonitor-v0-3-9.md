---
title: "chmonitor v0.3.9 — Know who runs what"
description: "Every dashboard query now says who ran it and from where, a new Dashboard Usage page reads that back, the users page shows activity and last login, and alerts thread on Matrix and Telegram."
date: 2026-10-24
tag: Release
version: v0.3.9
author: duyetbot
cover: /posts/v0.3.9/query-attribution-poster.webp
---

chmonitor **v0.3.9** ships **9 new features and 10 fixes** since v0.3.8.
Every query the dashboard sends now carries who ran it and from which page, a
new Dashboard Usage page reads that back, the users page shows who is active,
and repeat alerts thread under the first message.

## What's new in v0.3.9

<div class="hl-grid wide">
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/></svg></span><b>Query attribution</b><span>Each dashboard query carries the user, source, host and version.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16h3"/><path d="M7 12h8"/><path d="M7 8h12"/></svg></span><b>Dashboard Usage</b><span>Who uses the dashboard, which pages, and what it costs, global and per user.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><b>Users page</b><span>Status, queries, errors, last query, last login, and a detail row per user.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></span><b>Alert threads</b><span>Repeats, escalations and recovery reply under the first alert on Matrix and Telegram.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span><b>Webhook alert block</b><span>Opt-in structured alert data and top contributors for agents.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span><b>Optimization plan</b><span>Advisor findings ranked into one plan. It recommends, it never applies.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg></span><b>Replica drift</b><span>An opt-in toggle in the access matrix compares grants across replicas.</span></div>
</div>

## Every query says who sent it

Before this release, a dashboard query in `system.query_log` looked like any
other query from the same ClickHouse user. Now each one carries an attribution
record in two places. The SQL starts with one JSON comment:

```sql
/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,"version":"0.3.9","user":"jane","source":"chart:query-count","host":"ch-0"} */
SELECT ...
```

The same JSON goes into the `log_comment` setting, so you can read it back with
`JSONExtractString(log_comment, 'user')`. Pages, charts, the SQL console, agent
tools, cron jobs and per-user connections all send it.

A few rules keep it safe:

- The user comes only from a verified sign-in (a trusted proxy secret or a
  Clerk session). A crafted header cannot set it.
- Email is opt-in, and it never goes into the SQL comment.
- Cloud demo hosts record no user or email.
- A user whose profile sets `readonly=1` cannot set `log_comment`. On that
  error the query is sent again once with only the SQL comment.

Turn it off with `CHM_QUERY_ATTRIBUTION=false`. `CHM_QUERY_ATTRIBUTION_LABEL`
adds your own label, `CHM_QUERY_ATTRIBUTION_SQL_COMMENT` controls the comment,
and `CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL` adds the email to `log_comment`.

<figure class="video">
  <iframe src="/posts/v0.3.9/query-attribution.html" title="Query attribution, an interactive figure" loading="lazy" style="aspect-ratio:1280/834;background:transparent"></iframe>
  <figcaption>Interactive: each card is one dashboard query. The press stamps the attribution comment on it, the card files into query_log, and the column of the user who ran it grows by one. Hover a column, or use the arrow keys, to read one user's count. The names and counts are illustrative.</figcaption>
</figure>

<figure class="video">
  <video src="/posts/v0.3.9/query-attribution.mp4" poster="/posts/v0.3.9/query-attribution-poster.webp" controls muted loop preload="metadata" playsinline></video>
  <figcaption>Eight queries from three users go through the press and into the log, and each user's column grows as they file.</figcaption>
</figure>

## Dashboard Usage

The new **Dashboard Usage** page reads the attribution record back from the
query log. The global view has KPI tiles for queries, users, error rate, p95
duration and bytes read, charts for queries, errors and p95 over time, and top
10 lists for users, sources, pages, versions and labels.

Click a user for the per-user view: the same KPIs and charts for that one
person, their top sources and pages, recent queries as normalized shapes,
errors by message, and the most expensive queries. One selector sets the
window to 1, 7 or 30 days. Scans are capped at 30 days, and the page does not
poll. It needs the `operations` permission, and a user's view never shows
other users.

## Users page

The users page now answers who is active and what they run. Each row shows a
status (active, idle or inactive over this replica's 7-day query log), queries
in the last 24 hours and 7 days, errors, the last query, the last login from
`session_log`, and whether the account expires.

Open a row to see that user's queries per hour, query kinds, last five query
shapes, last login address and interface, roles and profiles, and links to
their usage, history, failed and running queries. When `query_log` or
`session_log` is missing, the page hides those columns instead of failing.

## Alerts

**Repeat alerts now thread.** On Matrix and Telegram, reminders, escalations
and the recovery reply under the first message of the alert, so one problem
stays in one thread. A thread is one host, rule and destination, from first
alert to recovery. Without a metadata database, alerts are sent as top-level
messages as before. Slack keeps the compact repeat line, because incoming
webhooks return no message id to reply to.

**Webhooks can carry a structured alert block.** Targets and subscriptions with
`details` turned on get one `alert` object: rule, metric, threshold, value,
previous value, trend, first seen, and repeat count. Cluster text sits under an
`untrusted` key, with secrets redacted and each string capped at 200
characters. It is built for agents that read alerts.

Firing alerts on those targets also list the **top contributors**: the top
five tables by disk or by active parts, or the top five running queries by
memory or by elapsed time, depending on the rule. Queries appear as normalized
shapes with no raw literals. If the read fails, the field is left out and the
alert still goes out.

This changes the raw webhook body: the key `details` is now `alert`, and
`details.firstFiredAt` is gone.

## Also in this release

- The advisor has a new **Optimization plan** tab. It ranks the findings the
  advisors already stored by gain over cost, lists risky steps as needing
  approval, and exports to Markdown or JSON. The DDL is copy-only, there is no
  apply button, and the agent gets a matching read-only tool.
- The access matrix has a **Compare replicas** toggle, off by default. It reads
  grants on every replica and shows where effective access differs. An
  unreachable replica is listed as skipped, not as drift.
- Hosts with no replicated tables show **Replication not used** on the queue
  page, health checks, the agent tool, insights and the summary chart, and the
  stuck-queue alert skips them.
- The MCP server has a read-only `get_current_findings` tool for current health
  findings.
- Agent errors now redact credentials in table functions like `s3` and
  `mysql`, signed URL params, emails and IP addresses.
- The sidebar shows a group's count only while the group is closed.
- Lockfiles are patched for the zod and astro advisories.

## Upgrading

Pull the new image or redeploy. Query attribution is on by default. If you
parse the raw webhook body, read `alert` instead of `details`.

```bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.9
```

On Kubernetes, Helm chart 0.2.19 ships with this release. It adds a
`queryAttribution:` block to `values.yaml` that sets the attribution env vars.

```bash
helm repo update
helm upgrade my-chm chmonitor/chmonitor --version 0.2.19
```

The `chm` CLI v0.1.5 sends its usage telemetry to the shared telemetry
service. Every opt-out still works, including `DO_NOT_TRACK` and
`CHM_TELEMETRY=off`.

## Read more

- [chmonitor v0.3.8](/v0.3.8/) — find what nobody reads
- [Deploy chmonitor on Kubernetes with Helm](/self-hosting-chmonitor-helm/)
- [AI agent docs](https://docs.chmonitor.dev/guide/ai-agent)
- [GitHub release v0.3.9](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.9)
