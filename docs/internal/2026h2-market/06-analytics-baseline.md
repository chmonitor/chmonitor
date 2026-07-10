# 06 — Analytics baseline + funnel definitions (M1)

> Companion to [`05-implementation-tasks.md`](./05-implementation-tasks.md) M1
> ("Product-analytics funnel + founder dashboard"). Records the pre-instrumentation
> baseline and defines the funnel as PostHog config, per the "prefer PostHog
> insights over custom UI" house convention — no new in-app founder dashboard is
> built here.

## Baseline snapshot — 2026-07-10

Distribution/reach metrics, captured once as the "before" line for M1. Re-run the
same commands periodically (e.g. monthly) to track movement; no automation is
wired for this yet (see Follow-ups).

| Metric | Value | Source |
|---|---|---|
| GitHub stars | 246 | `gh api repos/chmonitor/chmonitor --jq .stargazers_count` |
| GitHub forks | 40 | `gh api repos/chmonitor/chmonitor --jq .forks_count` |
| GitHub open issues | 27 | `gh api repos/chmonitor/chmonitor --jq .open_issues_count` |
| OSS installs (distinct instance hashes) | 4,182 | `curl https://telemetry.chmonitor.dev/v1/summary` → `total_installs` |
| Distinct install environments | 6 | same endpoint → `total_places` |
| Install breakdown by deploy target | cf=102, docker=8, dev=1, unknown=4,072 | same endpoint → `by_deploy_target` |
| Social followers (X/LinkedIn) | not tracked in-repo | manual — no API wired, see Follow-ups |

Telemetry data (`total_installs`, `by_deploy_target`) has accumulated since the D1
binding was wired 2026-07-07 — see the comment in `apps/telemetry/src/index.ts`.
Numbers before that date are not reflected in `total_installs`.

## Funnel definition

The SaaS conversion funnel this issue asks to track, as chmonitor product-analytics
events (see [`docs/content/operate/advanced/product-analytics.mdx`](../../content/operate/advanced/product-analytics.mdx)
for the full event catalog and env flags):

```
landing_view → signup → cluster_connect → advisor_recommendation_viewed → paywall_hit → upgrade_completed
```

| Funnel step | Event | Surface |
|---|---|---|
| Install / discover | `total_installs` (Product Telemetry, not PostHog) | OSS collector — anonymous, always-on |
| Landing view | `landing_view` | `apps/landing` |
| Signup | `signup` | Dashboard — Clerk account created within the last 2 minutes |
| Connect a cluster | `cluster_connect` | Dashboard — a ClickHouse connection is added and saved |
| First advisor recommendation | `advisor_recommendation_viewed` | Dashboard — `/advisor` page or agent chat tool-output, first time ≥1 recommendation renders |
| Paywall hit | `paywall_hit` | Dashboard — a request 402s on a classified billing limit and the paywall modal opens |
| Upgrade | `upgrade_completed` | Dashboard Worker (server-side) — a new Polar subscription goes live |

`install` isn't a PostHog event: chmonitor already has a dedicated, always-on,
anonymous OSS install counter (Product Telemetry, `apps/telemetry`) that's a
deliberately separate system from PostHog product analytics (see the two docs
pages). Baseline installs are pulled from that endpoint above rather than
duplicated as a PostHog event.

## Founder dashboard — PostHog Insights, not custom UI

Per the M1 "Files" pointer (`apps/dashboard`, `apps/telemetry`) and the repo's
"prefer PostHog insights/docs over custom UI" convention, the founder dashboard is
two PostHog Insights in the `chmonitor.dev` project, not new in-app code:

1. **Funnel insight** — Product analytics → Insights → New → Funnel. Steps, in
   order: `landing_view`, `signup`, `cluster_connect`,
   `advisor_recommendation_viewed`, `paywall_hit`, `upgrade_completed`.
   `upgrade_completed` is stitched to the same browser distinct-id as the
   steps before it (#2478 — see `product-analytics.mdx`), so this is now a
   real per-user conversion step, not just an aggregate count; the fallback to
   the shared `server` id only applies to pre-#2478 checkouts and manually
   created Polar subscriptions.
2. **Trends insight** — `signup`, `cluster_connect`, `checkout_started`,
   `upgrade_completed` as separate trend lines, weekly, to eyeball week-over-week
   funnel health without waiting on the stitched funnel step above.

Both are ordinary PostHog config (no code) — create them once in the PostHog UI
against the existing `chmonitor.dev` project and pin them to a dashboard there.

## Follow-ups (not done in this change)

- **No automated baseline refresh.** The table above is a one-time manual
  snapshot; there's no cron/script that re-pulls stars/installs on a schedule.
  A future task could add a small script (`gh api` + the telemetry `/v1/summary`
  endpoint) that appends a dated row somewhere trackable.
- **Social followers are entirely unmeasured.** No X/LinkedIn account is wired
  into any repo tooling; this line item needs a human to check the account(s)
  directly, or a future task to pull an API if/when official accounts exist.
- **PostHog Insights themselves are not created by this change** — the funnel/
  trends config above is written as instructions for whoever has PostHog
  project access; no PostHog API credential was available in this session to
  create them programmatically.
