---
title: "What's next in 0.3.x: Tools, workspace roles, Schema Compare"
description: "Already on main and Cloud — a Tools menu, per-browser workspace roles, Schema Compare, Settings Diff, and a What's new dialog. The next 0.3.x tag will include them."
date: 2026-08-19
tag: Update
---

These are **not a tagged GitHub release yet**. They are on `main` and on
[dash.chmonitor.dev](https://dash.chmonitor.dev). The next **0.3.x** tag will
pick them up. Self-hosters on `:latest` built from `main` already have them.

<div class="hl-grid">
  <div class="hl"><b>Tools menu</b><span>SQL Console, Explorer, Explain, Advisor, Chart Builder, Schema Compare, Settings Diff — last group in Main.</span></div>
  <div class="hl"><b>Workspace roles</b><span>Full / DBA / Engineer / SRE. Hide and pin pages locally. The sidebar follows this browser.</span></div>
  <div class="hl"><b>Schema Compare</b><span>Table DDL across hosts or replica nodes. Recommend-only plan — copy statements, never apply.</span></div>
  <div class="hl"><b>Settings Diff</b><span>system.settings and merge_tree_settings, pair or matrix. All matched when nothing differs.</span></div>
</div>

## Tools, at the end of Main

Interactive work used to live under Queries, Tables, and Operations. It now
lives in **Tools** — last group in Main, after Logs.

SQL Console, Data Explorer, Explain, Advisor, Chart Builder, Schema Compare,
Settings Diff. **AI Agent** stays its own group. Postgres hosts do not see
Tools (ClickHouse-family only).

The longer write-up is [A DBA, an SRE, and an engineer should not share a
sidebar](/customize-dashboard/).

## Schema Compare and Settings Diff

[DBA workflows](https://docs.chmonitor.dev/guide/guides/dba-workflows) is the
map.

**Schema Compare** (`/schema-diff`) diffs `CREATE TABLE` across saved connections
or replica nodes. One host is not enough — add a second, or compare nodes on
this cluster. The plan is copy-only. Advisor findings can also emit a local
statement plus an `ON CLUSTER` variant when topology is known.

**Settings Diff** (`/settings-diff`) diffs `system.settings` and
`system.merge_tree_settings`. Filter to differences, or to values changed from
default. When every setting matches: green check, **All matched**, then **All**
to list them anyway.

## What's new, next to Settings

The newspaper icon next to the Settings gear opens **What's new** — notes from
`docs/whats-new/` for each tagged version, newest first. It auto-opens once
after an upgrade.

## Also on this train

- **TTL and partition health** at `/ttl-partition-health` — inventory, not just
  move history on Storage Economics.
- Schema lint on Explorer table Overview (same recommend-only engine as
  Advisor).
- [Self-hosted commercial licenses](/self-hosted-licenses/) — host-count
  invoice, no key in the binary.
- Advisor: copyable local vs `ON CLUSTER` DDL.

## What this is not

It is not v0.3.4 until [release-please](https://github.com/chmonitor/chmonitor/releases)
cuts the tag. Do not treat this post as a changelog for a version number that
does not exist yet.

When that tag ships, we will scaffold a normal [release post](/v0.3.3/). Until
then: Cloud has it, `main` has it, `:latest` has it if you build from `main`.

## Related

- Recap: [What's new in chmonitor 0.3.x](/v0.3.3/)
- [Customize the dashboard](/customize-dashboard/)
- Docs: [DBA workflows](https://docs.chmonitor.dev/guide/guides/dba-workflows),
  [Settings](https://docs.chmonitor.dev/guide/features/settings)
