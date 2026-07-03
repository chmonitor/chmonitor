# 52 — Proactive weekly health report

## Kickoff prompt

```text
Execute plans/52-proactive-weekly-health-report.md ALONE. Add a weekly cron that turns the
insights engine + statistical baselines (plan 48) + capacity forecast (plan 50) into a shareable
cluster-health narrative, delivered via the configured channels (email plan 25 / Slack plan 37).
Invariants: self-hosted stays whole (fail-open without Clerk; opt-in per host); AI recommends,
never auto-applies; honest content (no claims beyond what insights computed); Postgres=NO for
2026 H2. Read the plan fully, honor STOP conditions, then run every Verification command and
update your row in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/lib/insights --isolate; bun run lint.
```

## Current reality (audited)

The insights engine (`apps/dashboard/src/lib/insights/generate-insights.ts` + `collectors.ts`)
runs every ~5 min and persists findings, and there is a health-sweep cron
(`routes/api/cron/health-sweep.ts`). But there is **no periodic digest** — nothing aggregates a
week of findings into a narrative or delivers it. This is a retention + upsell surface.

## Goal

A weekly cron that composes a per-host health narrative (top findings, trend vs. baseline,
capacity outlook, links to advisor recommendations) and delivers it via configured channels,
opt-in per host.

## Implement now (depth F)

- New `apps/dashboard/src/lib/insights/weekly-report.ts`:
  - `buildWeeklyReport(hostId)` — pull last 7d findings from the insights store, summarize by
    category/severity, fold in baselines (plan 48) and capacity forecast (plan 50), and produce a
    Markdown/HTML narrative + a compact summary object.
- New `apps/dashboard/src/routes/api/cron/weekly-report.ts` — CRON_SECRET-gated (mirror
  `health-sweep.ts`; fail-closed if secret unset), iterate opt-in hosts, build + deliver.
- Delivery reuses the alert adapters: email (plan 25) and/or Slack (plan 37); if neither is
  configured, persist the report only.
- Persist reports in a small D1 table `weekly_reports` (host_id, week_start, summary_json,
  delivered) mirroring the insights D1 store pattern; fail-open (swallow store errors).
- Opt-in flag per host in settings; add a Cloudflare cron trigger entry (weekly) in
  `wrangler.toml` `(verify)`.
- Tests: `apps/dashboard/src/lib/insights/__tests__/weekly-report.test.ts` — builds a report from
  fixture findings and asserts structure + that undelivered still persists.

## STOP conditions & drift check

- STOP if the insights store interface changed — reuse the existing store abstraction, don't add a
  parallel one.
- STOP if CRON_SECRET handling differs from `health-sweep.ts`; match it (fail-closed).
- Drift: confirm adapter entry points (plans 25/37) before wiring delivery; if not yet merged,
  gate delivery behind an adapter-present check and still persist.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/insights --isolate
bun run lint
```

## Done criteria

- Weekly cron builds a per-host narrative from real insights + baselines + capacity.
- Delivered via configured channel(s); persisted regardless of delivery.
- CRON_SECRET fail-closed; opt-in per host; test covers build + persist.

Priority: P1 · Effort: M · Depth: F · Wave: AI (Advisor) · Lever: Adoption / Revenue (retention surface)
