---
title: "chmonitor v0.3.7 — An agent that reads your page"
description: "A smarter AI agent that can read any dashboard page, alerts you set up from a health check, PeerDB stall and pattern alerts, task-based navigation, and a redesigned docs site."
date: 2026-10-11
tag: Release
version: v0.3.7
author: duyetbot
cover: /posts/v0.3.7/cover.webp
---

chmonitor **v0.3.7** ships **51 new features, 99 fixes, and 16 performance
changes** since v0.3.6. The agent got smarter, alerts are easier to set up,
the sidebar is easier to move around, and the docs have a new look.

<figure class="video video-wide">
  <iframe src="https://www.youtube-nocookie.com/embed/vGgSJ07akwo?rel=0" title="chmonitor v0.3.7 launch video" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="eager"></iframe>
</figure>

## What's new in v0.3.7

<div class="hl-grid wide">
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/></svg></span><b>Smarter agent</b><span>Reads any dashboard page, finds the right tool with search_tools, and signs in with AnyRouter.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/></svg></span><b>Alerts from health</b><span>Configure an alert straight from a health check, or declare it in alerts.yaml.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg></span><b>PeerDB alerts</b><span>Editable mirror rules, stall and throughput warnings, and one alert per error pattern.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/></svg></span><b>Easier navigation</b><span>Task groups, hub pages, pinned and recent pages on hover, and touch-friendly menus.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span><b>More reliable</b><span>Time-bounded log scans, friendly error text, and stricter API input checks.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span><b>New docs</b><span>A blog-style theme, and rule, tool, and env lists generated from the code.</span></div>
</div>

## A smarter agent

The agent can now read what any dashboard page shows with a new
`get_page_data` tool, so you can ask about the page in front of you. A tool
catalog with a `search_tools` tool lets the agent find the right tool
instead of loading every one up front. There is also a read-only PeerDB
metrics tool, and the PeerDB tools return grouped log patterns.

<img src="/posts/v0.3.7/agent.webp" alt="AI chat with the agent settings panel and a Sign in with AnyRouter link" width="2000" height="1250" loading="eager" />

- **Sign in with AnyRouter.** Guests and signed-in users can sign in with
  AnyRouter from agent settings (behind a flag). An AnyRouter token is never
  sent to another provider.
- **Your own data.** When you are signed in, the agent answers from your own
  connection, never the demo host.
- **Control tools by default.** Control tools are on by default for
  self-hosted and off in Cloud.
- **Sensible defaults.** The agent picks a model from whichever provider key
  is set, and you can export conversation history as JSONL.
- **Lighter requests.** Output tokens and steps are capped, tool results are
  capped by size, and old tool results are compacted before they go back to
  the model.

## Alerts and health

You can now configure an alert right from a health check's detail dialog, and
the dialog shows whether that check is already alerting. Alerting turns on
when a channel is configured, and built-in alerts can be listed and renamed.
The Advanced sections of Alert Settings are regrouped by job, and six new
built-in rules were added.

<img src="/posts/v0.3.7/alert-settings.webp" alt="Alert Settings page with threshold chart, channel and alert counts, and tabs for alerts, thresholds, activity, and advanced" width="2000" height="1250" loading="lazy" />

Self-hosters can declare alerts in **alerts.yaml**. Its thresholds apply to
the health sweep and to current findings, merged through one source layer.

**PeerDB** alerting got much deeper:

- Editable alert rules with mirror match, thresholds, and mute.
- A warning when a running mirror has not finished a sync batch in 30
  minutes, and when a running CDC mirror stops moving rows.
- An alert when the PeerDB API is unreachable or auth fails.
- One alert per error-log pattern instead of one per mirror. Logs can be
  grouped by mirror, table, or message pattern, and noisy patterns muted.

Insights also gained replication-queue and insert-backpressure checks, and
broken detached parts are now reported on their own.

## Easier navigation

The sidebar is regrouped into task groups, and the main groups have hub
landing pages. Hover a group to see its pinned and recent pages. On touch
screens, sidebar pages have a row actions menu, and controls that used to
show only on hover now stay visible. Pages that are not available on your
deployment are hidden by default.

## More reliable

- Scans of `query_log` and `part_log` are bounded by time, and health and
  table scans are restricted to local database engines.
- The dashboard and Explorer show friendly error text instead of raw
  ClickHouse messages. Agent connection errors become clear next steps.
- The API classifies ClickHouse errors by code, returns 400 for malformed
  JSON, rejects bad host ids and limit params, and enforces feature
  permissions on table routes.
- Dialogs fit small screens, and empty states are real empty states.

## New docs

[docs.chmonitor.dev](https://docs.chmonitor.dev) has a blog-style theme and
new typography. Rule, tool, env, and version lists are now generated from the
code, with a test that catches drift.

<img src="/posts/v0.3.7/docs.webp" alt="The redesigned chmonitor documentation home page with Guide, Operate, and Reference sections" width="2000" height="1250" loading="lazy" />

## Upgrading

Pull the new image or redeploy. Self-hosted agents now have control tools on by default; set `AGENT_ENABLE_CONTROL_TOOLS=false` if you do not want them.

```bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.7
```

## Read more

- [chmonitor v0.3.6](/v0.3.6/) — everything since v0.2
- [AI agent docs](https://docs.chmonitor.dev/guide/ai-agent)
- [GitHub release v0.3.7](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.7)
