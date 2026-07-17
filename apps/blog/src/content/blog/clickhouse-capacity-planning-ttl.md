---
title: "Capacity planning with the disk-forecast and TTL advisor"
description: "A worked example of forecasting ClickHouse disk exhaustion and getting a recommend-only TTL adjustment before an out-of-space incident happens."
date: 2026-07-10
tag: Case study
---

This is a composite worked example built for this post, not a real incident — the workflow and tool behavior described are exactly how chmonitor's capacity-planning tools behave, run against a representative cluster. The scenario: disk usage on a high-ingest events table has been creeping up for weeks, and nobody wants to find out it hit 100% the hard way.

## The problem

A team ingesting clickstream events into a `MergeTree` table notices disk usage alerts trending upward over several weeks, but no single day looks alarming enough to act on. Reactive capacity management — waiting for a disk-full page — is exactly the failure mode this workflow is meant to avoid.

## Investigating

### Step 1 — forecast when the disk actually runs out

Instead of eyeballing a disk-usage chart and guessing, ask the AI agent to forecast it directly. This calls the `forecast_disk_capacity` tool, which projects from `system.part_log` `NewPart` write volume over the last 30 days (plus the top contributing tables) and reports against a configurable horizon (default 90 days).

> Forecast when this host's disks will run out of free space.

The tool is explicit about its own limits: if `system.part_log` isn't enabled on the cluster, it reports that clearly instead of fabricating a forecast — there's no silent guess.

### Step 2 — identify the retention floor

Before asking for a TTL suggestion, the actual business/compliance requirement has to be pinned down — how many days of this table's data legally or operationally must be kept. This case assumes a 30-day floor (chmonitor's own default when none is specified, though it's meant to be overridden explicitly whenever the real requirement differs).

### Step 3 — get a TTL recommendation

> Suggest a TTL adjustment for `default.events` that keeps disk usage under control, with a 30-day retention floor.

This calls `suggest_ttl_adjustment`, which returns a suggested `ALTER TABLE ... MODIFY TTL ...` string aimed at keeping projected disk utilization at or under 80%, plus a risk note — and never suggests less than the retention floor given. Like the forecast tool, it reports a clear "part_log not available" message rather than a fabricated suggestion if the underlying data isn't there.

## Root cause

Sustained growth without a bounding TTL on a high-ingest table — normal and expected behavior for an ever-growing events table, but one that needs an explicit retention policy rather than "grow until the disk fills up."

## Resolution

The suggested `ALTER TABLE ... MODIFY TTL ...` is **not applied automatically** — this is a recommend-only tool, same as the query optimization advisor. Applying it is a deliberate, reviewed step: check the suggested cutoff against actual compliance/business requirements, run it in a maintenance window (TTL changes trigger background part expiry, not an instant deletion), and confirm the disk-usage trend flattens afterward by re-running the forecast or watching the [Disks](https://docs.chmonitor.dev/guide/features) page.

## Takeaway

Capacity planning works best as a forecast-then-recommend loop, not a reactive one: `forecast_disk_capacity` tells you *when* a problem becomes real, `suggest_ttl_adjustment` gives you a concrete, floor-respecting fix to review — but both stop short of touching your table. Reach for this pairing whenever a disk-usage trend looks concerning but isn't yet an emergency; see [what to do once it already is one](/clickhouse-disk-full-emergency/).

## Related

- Docs: [AI agent capabilities](https://docs.chmonitor.dev/guide/ai-agent/capabilities) — `forecast_disk_capacity` and `suggest_ttl_adjustment` in the Capacity planning tool group.
- Docs: [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — quick start and configuration.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] States explicitly this is a worked/composite example, not a real incident.
- [x] forecast_disk_capacity behavior (system.part_log NewPart events, system.disks, 90-day default horizon, clear message when part_log unavailable) checked against apps/dashboard/src/lib/ai/agent/tools/storage-tools.ts and docs/content/guide/ai-agent/capabilities.mdx.
- [x] suggest_ttl_adjustment behavior (ALTER TABLE ... MODIFY TTL suggestion, retentionRequirementDays floor, defaults to 30, recommend-only, part_log-gated message) checked against the same storage-tools.ts source.
- [x] "Recommend-only, never applied automatically" claim matches tool docstrings exactly — no claim that the advisor auto-applies TTL changes.
- [x] Every chmonitor tool named is merged to main (apps/dashboard/src/lib/ai/agent/tools/storage-tools.ts).
- [x] Docs cross-link resolves (docs/content/guide/ai-agent/capabilities.mdx).
- [x] Internal link to /clickhouse-disk-full-emergency/ points at a post created in this same batch.
-->
