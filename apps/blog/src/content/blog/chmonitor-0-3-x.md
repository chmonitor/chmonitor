---
title: "chmonitor v0.3.3 — guest AI caps, alert templates, favorites"
description: "After four days of agents working day and night — 50 PRs, 83 comments — v0.3.3 caps Cloud guest AI, adds alert templates, and lets you drag pinned favorites."
date: 2026-08-16
tag: Release
version: v0.3.3
---

After **four days** of agents working day and night — **50 pull requests** and
**83 comments** on GitHub (33 of 50 commits after hours) — chmonitor **v0.3.3**
is the 16 Aug 2026 tag. Guest AI on Cloud is capped, alerts start from
templates, and pinned sidebar favorites drag to reorder.

Every path below opens the live demo: [dash.chmonitor.dev](https://dash.chmonitor.dev).

<div class="hl-grid">
  <div class="hl"><b>Guest AI caps</b><span>Cloud demo chat is metered so a public guest cannot run unbounded tool loops.</span></div>
  <div class="hl"><b>Alert templates</b><span>Pick a preset instead of filling a threshold spreadsheet.</span></div>
  <div class="hl"><b>Favorites</b><span>Pinned sidebar items drag to reorder.</span></div>
  <div class="hl"><b>Settings</b><span>The gear sits next to Sign in. Changes stay in this browser.</span></div>
</div>

## What shipped

### Guest AI on Cloud

Anonymous visitors on [dash.chmonitor.dev](https://dash.chmonitor.dev) can still
try the [agent](https://dash.chmonitor.dev/agents). Usage is **capped and
tracked**, so a public demo cannot burn unbounded tool calls.

You pick models dynamically: AnyRouter presets, plus a custom model field. The
AnyRouter sign-in prompt only shows when no `ANYROUTER_API_KEY` is set.

Self-hosted builds are unchanged — guest caps are Cloud-only.

### Alert templates

[Alert settings](https://dash.chmonitor.dev/alert-settings) use **templates and
presets** instead of a wall of empty threshold forms. Pick a starting point,
then edit. Docs: [Health](https://docs.chmonitor.dev/guide/features/health).

### Favorites, Settings, Merges

Pinned sidebar favorites **drag to reorder**. Pin and grip icons stay on hover
so they do not sit on top of the row.

**Settings** opens from the gear next to Sign in (or the avatar) on
[dash.chmonitor.dev](https://dash.chmonitor.dev). Theme, timezone, units, and
workspace stay **local to this browser**.

When no merges are running, [Merges](https://dash.chmonitor.dev/merges) shows
the **last completed ones** so the page is not empty.

## Upgrade

Self-hosters: pull the image you already run.

```bash
docker pull ghcr.io/chmonitor/chmonitor:v0.3.3
```

Cloud ([dash.chmonitor.dev](https://dash.chmonitor.dev)) already tracks this
tag. Nothing to migrate.

The full changelog is in the
[GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.3).
