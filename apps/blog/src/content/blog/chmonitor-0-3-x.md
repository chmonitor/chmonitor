---
title: "chmonitor v0.3.3 — guest AI caps, alert templates, favorites"
description: "Cloud guest AI is capped and metered. Alerts use templates. Pinned favorites drag to reorder. Settings sits next to Sign in."
date: 2026-08-16
tag: Release
version: v0.3.3
---

chmonitor **v0.3.3** is the 16 Aug 2026 tag. Guest AI on Cloud is capped, alerts
start from templates, and pinned sidebar favorites drag to reorder.

<div class="hl-grid">
  <div class="hl"><b>Guest AI caps</b><span>Cloud demo chat is metered so a public guest cannot run unbounded tool loops.</span></div>
  <div class="hl"><b>Alert templates</b><span>Pick a preset instead of filling a threshold spreadsheet.</span></div>
  <div class="hl"><b>Favorites</b><span>Pinned sidebar items drag to reorder.</span></div>
  <div class="hl"><b>Settings</b><span>The gear sits next to Sign in. Changes stay in this browser.</span></div>
</div>

## Guest AI on Cloud

Anonymous visitors on [dash.chmonitor.dev](https://dash.chmonitor.dev) can still
try the agent. Usage is **capped and tracked**, so a public demo cannot burn
unbounded tool calls.

You pick models dynamically: AnyRouter presets, plus a custom model field. The
AnyRouter sign-in prompt only shows when no `ANYROUTER_API_KEY` is set.

Self-hosted builds are unchanged — guest caps are Cloud-only.

## Alert templates

[Alert settings](https://docs.chmonitor.dev/guide/features/health) use
**templates and presets** instead of a wall of empty threshold forms. Pick a
starting point, then edit.

## Favorites, Settings, Merges

Pinned sidebar favorites **drag to reorder**. Pin and grip icons stay on hover
so they do not sit on top of the row.

**Settings** opens from the gear next to Sign in (or the avatar). Theme,
timezone, units, and workspace stay **local to this browser**.

When no merges are running, the Merges page shows the **last completed ones** so
the page is not empty.

[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.3) ·
16 Aug 2026.

## Upgrade

Self-hosters: pull the image you already run.

```bash
docker pull ghcr.io/chmonitor/chmonitor:latest
```

Cloud (`dash.chmonitor.dev`) already tracks this tag. Nothing to migrate.
