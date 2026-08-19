---
title: "What's new in chmonitor 0.3.x"
description: "Three patch releases since the v0.3 rebuild: interactive topology, a live MCP playground, guest AI caps, simpler alerts, and a sidebar you can pin and reorder."
date: 2026-08-19
tag: Release
version: v0.3.3
---

chmonitor **v0.3** was the rebuild. **v0.3.1**, **v0.3.2**, and **v0.3.3** are
what we shipped on top of it — three tagged releases in August, all GPL-3.0,
same Docker image, same Cloud app.

If you last looked at the [v0.3 launch post](/v0.3/), this is the recap.

<div class="hl-grid">
  <div class="hl"><b>v0.3.1</b><span>Drag-and-inspect cluster topology. The agent picks models from real usage, not a static list.</span></div>
  <div class="hl"><b>v0.3.2</b><span>Fleet strip with sparklines, a live MCP Playground, and alert channels that start from what you already configured.</span></div>
  <div class="hl"><b>v0.3.3</b><span>Guest AI caps on Cloud, alert templates, drag-to-reorder favorites, Settings next to Sign in.</span></div>
</div>

## v0.3.1 — topology you can actually use

[Cluster topology](https://docs.chmonitor.dev/guide/features/topology) is no
longer a static drawing. Drag nodes, click a glyph, inspect latency and
membership. On ClickHouse 26.2+ the parts page also says **why** a part was
postponed instead of leaving you to guess.

The AI agent auto-picks [AnyRouter](https://docs.chmonitor.dev/guide/ai-agent)
models from usage, not a hard-coded roster.

[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.1) ·
11 Aug 2026.

## v0.3.2 — fleet, MCP, alerts

A **fleet** strip sits on the host switcher: metrics and sparklines for every
saved connection, so you see the noisy node before you click into it.

The [MCP](https://docs.chmonitor.dev/guide/ai-agent) page has a real Playground
client (2026-07-28 spec), not a copy-paste blob.

Alert settings lead with **channels you already configured**. The rest stay
behind Add channel — no wall of empty forms.

Explorer table Overview is denser and engine-aware, with highlighted DDL. The
query-activity heatmap picks a month window that fits the screen.

[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.2) ·
12 Aug 2026.

## v0.3.3 — caps, templates, favorites

Cloud **guest AI** is capped and metered so a public demo cannot run unbounded
tool loops. You pick models dynamically, including AnyRouter presets and a
custom model field.

Alerts use **templates and presets** instead of a threshold spreadsheet.

Pinned sidebar favorites drag to reorder. Settings opens from the gear next to
Sign in — local to this browser. When no merges are running, the Merges page
shows the last completed ones so the page is not empty.

[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.3) ·
16 Aug 2026.

## Upgrade

Self-hosters: pull the image you already run.

```bash
docker pull ghcr.io/chmonitor/chmonitor:latest
```

Cloud (`dash.chmonitor.dev`) already tracks these tags. Nothing to migrate.

## What's next

The next 0.3.x tag is not cut yet. Tools, workspace roles, Schema Compare, and
Settings Diff are already on `main` — see [What's next in 0.3.x](/whats-next-0-3-x/).

## Related

- [chmonitor v0.3 — a full rebuild](/v0.3/)
- Docs: [Getting started](https://docs.chmonitor.dev/guide/getting-started)
- [All GitHub releases](https://github.com/chmonitor/chmonitor/releases)
