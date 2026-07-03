# 50 — Capacity forecast & TTL advisor

## Goal
`forecast_disk_capacity(hostId, horizonDays?)` and `suggest_ttl_adjustment(database, table, retentionRequirementDays?)` agent tools that forecast disk-full and recommend TTL/partition changes — **recommend-only**, never auto-applied, never below the stated retention.

## Current reality (audited)
Storage tools exist (`apps/dashboard/src/lib/ai/agent/tools/storage-tools.ts`) and disk usage is surfaced, but there is no write-rate trend, no disk-full forecast, and no TTL recommendation. `system.part_log` (NewPart events) carries the data to model growth.

## Implement now (depth F)
- New `apps/dashboard/src/lib/ai/advisor/capacity-forecaster.ts`:
  - `forecastDiskFull(hostId)` — aggregate `system.part_log` NewPart bytes by day (last 30d), fit `bytes = a·day + b`, project against `system.disks.free_space`; return `{ daysToFull, fullDate, dailyGrowthBytes, confidence }`.
  - `identifyHotTables(hostId, n)` — top-N tables by write rate.
  - `suggestTtl(table, retentionDays)` — solve for a TTL that keeps utilization ≤80% while never dropping below `retentionDays`; emit `ALTER TABLE … MODIFY TTL date + INTERVAL N DAY` as a **suggestion string** with a risk note.
- Extend `storage-tools.ts` with the two tools (read-only queries only).
- Version-gate `part_log` availability (optional table) via the existing table-existence check.
- Tests: `apps/dashboard/src/lib/ai/advisor/__tests__/capacity-forecaster.test.ts` with a synthetic part_log series → asserts forecast within tolerance and that a TTL suggestion never violates the retention floor.

## STOP conditions & drift check
- STOP if `part_log` is disabled — return a clear "enable system.part_log" note, don't fabricate a forecast.
- STOP before emitting any TTL that would delete data inside the retention window.
- Drift: confirm `storage-tools.ts` path and the table-existence helper still exist.

## Done criteria
- Forecast within ~15% on the synthetic series; clear message when part_log absent.
- TTL suggestions are strings only (never executed) and never below the retention floor (tested).
- Both tools available to the agent (and the weekly report, plan 52).
