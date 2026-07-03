---
title: "Alerting to Slack and Discord"
description: "Wire chmonitor's health sweep to a Slack or Discord webhook so your team gets notified the moment a check crosses a threshold — no polling the dashboard required."
date: 2026-07-03
tag: How-to
---

chmonitor's `/health` page checks replication lag, failed mutations, disk usage
and a handful of other signals on a schedule you control. Left alone, that only
helps the person who remembers to look at the page. The health-sweep cron
endpoint closes that gap: point it at a Slack or Discord incoming webhook and
it posts a message whenever a check meets or exceeds a severity threshold.

## Prerequisites

- A chmonitor instance already connected to at least one ClickHouse host.
- A Slack **incoming webhook URL** (Slack app → Incoming Webhooks) or a
  Discord **channel webhook URL** (Channel Settings → Integrations →
  Webhooks).
- The ability to set environment variables / secrets on your deployment
  (Cloudflare Worker secret, Docker env, or K8s Secret).

## Steps

### 1. Set the required secrets

The cron endpoint refuses to run unless `CRON_SECRET` is set — it guards
`/api/cron/health-sweep`, and the same endpoint also runs `retention-prune`,
which deletes old data, so it fails closed by design.

```bash
# Cloudflare Workers
wrangler secret put CRON_SECRET
wrangler secret put HEALTH_ALERT_WEBHOOK_URL
```

For Docker or Kubernetes, set the same names as regular environment variables
(`CRON_SECRET`, `HEALTH_ALERT_WEBHOOK_URL`) via your `.env` file or Secret.

### 2. Enable alert dispatch

```bash
HEALTH_ALERT_ENABLED=true
HEALTH_ALERT_MIN_SEVERITY=warning   # or "critical" to only page on the worst checks
HEALTH_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
CRON_SECRET=<random-secret>
```

The same `HEALTH_ALERT_WEBHOOK_URL` works for both Slack and Discord — the
sweep posts `{"text": "...", "content": "..."}`, and each platform reads the
field it understands.

### 3. Schedule the sweep

On Cloudflare Workers, add a cron trigger in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

Self-hosting on Docker or Kubernetes without a Workers Cron? Call the endpoint
from any external scheduler (a system cron job, GitHub Actions schedule, etc.)
with the same `Authorization` header shown below.

### 4. Call it manually to test

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-chmonitor.example.com/api/cron/health-sweep
```

## Verifying it worked

The endpoint always returns HTTP 200 with a JSON array of check results —
dispatch happens server-side and doesn't block the response. The simplest way
to confirm a message actually went out is to trip a threshold intentionally
(temporarily lower `HEALTH_ALERT_MIN_SEVERITY` to `warning`) and watch the
channel. If you're on Cloud with D1 configured, the `/health` page's alert
history also records every dispatch attempt and whether delivery succeeded —
that history isn't available on a self-hosted deployment without D1.

## Related

- Docs: [Health checks & alerting](https://docs.chmonitor.dev/guide/features/health)
  — the full reference for every check, threshold, and environment variable.
