---
title: "chmonitor v0.3.5 + v0.3.6 — PeerDB alerting, a local CLI, and a quieter sidebar"
description: "75 commits and 185 pull requests across five weeks: PeerDB grew a full alert cycle, the Rust CLI learned local named connections, the sidebar learned to stay out of the way, and the public API surface got hardened."
date: 2026-09-27
tag: Release
version: v0.3.6
cover: /posts/v0.3.5/cover.webp
---

Two releases, five weeks, **185 pull requests** merged across the monorepo and
**75 commits** in the dashboard's own release range. v0.3.5 and v0.3.6 are the
tags for everything after
[v0.3.4](/chmonitor-v0-3-4/) — and the through-line is that chmonitor got a
lot better at telling you when something is wrong, and a lot quieter about
everything else.

<div class="hl-grid">
  <div class="hl"><b>PeerDB alerting</b><span>A real alert cycle — classify, format, validate, audit, and investigate before delivery. Not a status list any more.</span></div>
  <div class="hl"><b>Custom webhook targets</b><span>Per-deployment alert webhooks, configured through Helm, HTTPS required.</span></div>
  <div class="hl"><b>A local CLI</b><span><code>chm add</code>, <code>chm ls</code>, <code>chm use</code> — named connections on your own machine, no dashboard round-trip.</span></div>
  <div class="hl"><b>A quieter sidebar</b><span>Essential first-run sidebar, day-to-day pages by default, hover-add for the rest.</span></div>
  <div class="hl"><b>Hardened public API</b><span>ClickHouse credentials redacted from responses, hostId validated, rate limits on the public probe endpoints.</span></div>
  <div class="hl"><b>Accessibility pass</b><span>Real browser sweeps: nested interactive controls, focus rings, status announcements, native button semantics.</span></div>
</div>

## PeerDB learned to alert

[PeerDB](/peerdb-monitoring/) has been a monitoring surface since July — mirror
status, CDC batch history, lag triage, slot health. What was missing was the
last step: telling you when a mirror goes bad *without* you going to look.

v0.3.5 shipped a runtime alert cycle — a collector, an orchestrator, and sweep
dispatch wiring — on top of alerting that classifies a finding, formats it,
validates it, keeps an audit trail, and **investigates before delivery**. That
last part is the one worth naming: the system is expected to try to explain an
alert before it pages you, so the notification arrives with a cause attached
rather than a bare threshold breach.

Alongside it: read-only fleet metrics, a read-only mirror-status tool for the
AI agent, and a batch of fixes closing auth and cache-isolation gaps.

## Alerts you can point at your own endpoint

<img src="/posts/v0.3.5/health-alerts.webp" alt="chmonitor Health Summary with critical and warning findings: failed queries, replication lag, query timeout breaches and readonly replicas" width="2000" height="1250" loading="lazy" decoding="async" />

Health-alert findings can now go to destinations you declare, per deployment.
The Helm chart renders an optional `alertWebhooks` block into the
`HEALTH_ALERT_WEBHOOK_TARGETS` contract — non-secret fields as JSON in the
ConfigMap, URLs and secret headers as Secret-backed env vars, never in the
ConfigMap:

```yaml
alertWebhooks:
  enabled: true
  targets:
    - name: team-alerts
      url: "https://hooks.example.com/…"
      headers:
        - name: X-Source
          value: chmonitor
```

URLs must be `https://`; plain HTTP needs an explicit `allowInsecureHttp` opt-in
per target, because a webhook ships operational detail about your cluster to
whatever URL you name. The whole block is disabled by default, so Docker and
OSS behaviour is unchanged until you opt in. Targets saved through the UI merge
with the GitOps-declared ones **by name** and win per-field; secret references
always resolve from the deployment environment. The legacy global
`HEALTH_ALERT_WEBHOOK_URL` keeps working unchanged.

## `chm` learned local connections

The standalone Rust CLI can now hold named connections **on your own machine**:

```bash
chm add      # save a ClickHouse HTTP or postgres:// URL as a named connection
chm ls       # list them
chm use      # switch the active one
chm rm       # remove one
```

This is the piece that removes the last reason to keep a tab open. Before, every
diagnostic meant pasting a URL into the dashboard; now the connections live
locally, `chm doctor` checks them, and the dashboard is somewhere you go when
you want a picture rather than an answer. Replica nodes are not counted as
separate hosts for licensing — they are the same cluster.

## The sidebar got quieter

The Essential first-run sidebar shows the pages you use daily and folds
everything else away, with hover-**+** to add a sibling back and a **More**
flyout for the full catalog. Group headings open a per-category dialog rather
than dropping you into a forty-checkbox wall. It is all reversible, and
Settings → Workspace → Navigation still has the Full / DBA / Engineer / SRE /
Custom roles.

The long argument for why a DBA, an SRE and an engineer should not share a
sidebar is still
[A DBA, an SRE, and an engineer should not share a sidebar](/customize-dashboard/).

## The unglamorous half: we hardened the public surface

Some of the most valuable commits in this range are not features.

- **ClickHouse host credentials are redacted from public API responses.**
- **`hostId` is validated** at the route boundary and public-route error
  handling no longer leaks internals.
- **Public probe endpoints got auth and rate-limit guards.** These are the
  endpoints that were easiest to hammer.
- **Device, cron and API-key auth surfaces were hardened**, with route tests.
- Advisor batch queries were fixed for correctness and sanitised, and the
  weekly report now integrates with them.

None of that shows up in a screenshot, and all of it matters more than most
features do.

## Upgrading

Nothing here changes how you connect. `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`,
`CLICKHOUSE_PASSWORD` and `CLICKHOUSE_NAME` are unchanged from v0.3.4, and the
`NEXT_PUBLIC_*` → `VITE_*` migration from v0.3 still applies if you have not done
it — see [Migrate to v0.3](https://docs.chmonitor.dev/reference/migrating/v0-3).

```bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.6
```

Pin it, and pin the chart at `0.2.16` if you are on Kubernetes.

Every page mentioned above opens on the live demo at
[dash.chmonitor.dev](https://dash.chmonitor.dev) — the PeerDB section at
`/peerdb`, the agent settings at `/agents`, and Health at `/health`.
