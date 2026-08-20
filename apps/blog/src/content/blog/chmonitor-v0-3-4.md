---
title: "chmonitor v0.3.4 — Tools, Schema Compare, workspace roles"
description: "After four days of agents working day and night — 106 PRs, 267 comments — v0.3.4 ships a Tools menu, workspace roles, Schema Compare, Settings Diff, TTL inventory, What's new, and self-hosted licenses."
date: 2026-08-20
tag: Release
version: v0.3.4
---

After **four days** of agents working day and night — **106 pull requests** and
**267 comments** on GitHub — chmonitor **v0.3.4** is the tag for everything that
landed on `main` after v0.3.3. Tools, workspace roles, Schema Compare, Settings
Diff, TTL inventory, and self-hosted licenses are in this release.

Every path below opens the live demo: [dash.chmonitor.dev](https://dash.chmonitor.dev).

<div class="hl-grid">
  <div class="hl"><b>Tools menu</b><span>SQL Console, Explorer, Explain, Advisor, Chart Builder, Schema Compare, Settings Diff — last group in Main.</span></div>
  <div class="hl"><b>Workspace roles</b><span>Full / DBA / Engineer / SRE. Hide and pin pages in this browser.</span></div>
  <div class="hl"><b>Schema Compare</b><span>Table DDL across hosts or replica nodes. Copy-only plan — never applied.</span></div>
  <div class="hl"><b>Settings Diff</b><span>system.settings and merge_tree_settings, pair or matrix. All matched when nothing differs.</span></div>
  <div class="hl"><b>TTL inventory</b><span>Every MergeTree table's TTL and PARTITION BY, plus part-health charts.</span></div>
  <div class="hl"><b>Licenses</b><span>Self-hosted host-count licenses. Invoice, not a key in the binary.</span></div>
</div>

## What shipped

### Tools and workspace

- **Tools** sidebar group: [SQL Console](https://dash.chmonitor.dev/sql),
  [Data Explorer](https://dash.chmonitor.dev/explorer),
  [Explain](https://dash.chmonitor.dev/explain),
  [Advisor](https://dash.chmonitor.dev/advisor),
  [Chart Builder](https://dash.chmonitor.dev/dashboard),
  [Schema Compare](https://dash.chmonitor.dev/schema-diff),
  [Settings Diff](https://dash.chmonitor.dev/settings-diff). Last group in Main.
  Postgres hosts do not see it.
- **Workspace roles** in Settings: Full, DBA, Engineer, SRE. Pick a role and
  the Navigation tree remounts collapsed.
- Customize the sidebar from the Settings menu tree.
- Hover **Hide** next to Pin on a leaf. Undo toast. Restore in Settings →
  Workspace → Navigation.
- Longer write-up: [A DBA, an SRE, and an engineer should not share a
  sidebar](/customize-dashboard/).

### Schema Compare and Settings Diff

[DBA workflows](https://docs.chmonitor.dev/guide/guides/dba-workflows) is the
map.

- **[Schema Compare](https://dash.chmonitor.dev/schema-diff)** diffs `CREATE TABLE`
  across saved connections or replica nodes. One host is not enough — add a
  second, or compare nodes on this cluster. The plan is copy-only.
- **[Settings Diff](https://dash.chmonitor.dev/settings-diff)** diffs
  `system.settings` and `system.merge_tree_settings`. Filter to differences, or
  to values changed from default. When every setting matches: **All matched**.
- Advisor findings can emit a **local** statement plus an `ON CLUSTER` variant
  when topology is known. Try [Advisor](https://dash.chmonitor.dev/advisor).

### Cluster ops

- **[TTL and partition health](https://dash.chmonitor.dev/ttl-partition-health)**
  — inventory of MergeTree TTL and `PARTITION BY`, with partition and part
  counts. Tables without TTL still appear. Recommend-only: this page does not
  run `ALTER TTL` or `DROP PARTITION`.
- Schema lint on [Explorer](https://dash.chmonitor.dev/explorer) table Overview
  (same recommend-only engine as Advisor).
- **What's new** dialog next to Settings — notes from `docs/whats-new/` for
  each tagged version. Auto-opens once after an upgrade.

### Agent

- Cloud demo **[guests can chat](https://dash.chmonitor.dev/agents)** (still
  under the v0.3.3 guest cap).
- Keyless **Firecrawl MCP** is connected by default (`CHM_AGENT_FIRECRAWL_MCP`,
  opt-out).
- Follow-up suggestions are tool-aware and sit on the composer.
- Chat messages, tool cards, and markdown rendering are tighter. The tool loop
  stops at 16 steps.

### Licenses and CLI

- Paid product is a **self-hosted commercial license** sized by host count, not
  a Cloud seat. No key in the binary. Details:
  [We're selling self-hosted licenses](/self-hosted-licenses/).
- Checkout asks for company details before Polar charges.
- Instance ping can send `CHM_LICENSE_KEY`.
- CLI: `chm upgrade` (ranks `chm-v*` tags by semver).

## Upgrade

Self-hosters: pull the image you already run.

```bash
docker pull ghcr.io/chmonitor/chmonitor:latest
```

Cloud ([dash.chmonitor.dev](https://dash.chmonitor.dev)) already has this.
Nothing to migrate.

The full commit list is in [PR #3035](https://github.com/chmonitor/chmonitor/pull/3035).
