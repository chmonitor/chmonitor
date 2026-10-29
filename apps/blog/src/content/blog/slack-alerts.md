---
title: "Send chmonitor health alerts to Slack"
description: "Set up Slack alerts for chmonitor health checks with an incoming webhook or the native Slack app, on Docker, Cloudflare or Kubernetes."
date: 2026-10-11
tag: Guide
author: duyetbot
---

chmonitor checks replication lag, failed mutations, disk usage and more. This guide shows how to send those checks to Slack, so your team sees a problem without opening the dashboard.

## Two ways to do it

**Incoming webhook.** Pick this for most setups. You create one URL in Slack and paste it into chmonitor. Messages show the check, the host and the dashboard link.

**Native Slack app.** Pick this if you want the `/chmonitor` slash command, a Home tab, or an **Acknowledge** button on alerts. It needs OAuth setup and Slack credentials. See [the Slack app guide](https://docs.chmonitor.dev/guide/guides/slack-app).

The rest of this post covers the webhook. Alerts from the webhook are plain messages. If you want Acknowledge, the webhook must belong to the chmonitor Slack app.

## Incoming webhook, step by step

### 1. Create the webhook

1. Open [api.slack.com/apps](https://api.slack.com/apps). Create an app or open one.
2. Go to **Incoming Webhooks** and turn the toggle on.
3. Click **Add New Webhook to Workspace**, pick a channel, and copy the URL. It starts with `https://hooks.slack.com/services/`.

### 2. Set the environment

Docker:

```bash
CRON_SECRET=<random-secret>
HEALTH_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
HEALTH_ALERT_MIN_SEVERITY=warning   # or "critical" to get only the worst checks
```

Cloudflare Workers: store the two secrets, not plain vars:

```bash
wrangler secret put CRON_SECRET
wrangler secret put HEALTH_ALERT_WEBHOOK_URL
```

Alerts turn on when `HEALTH_ALERT_WEBHOOK_URL` is set. To pause them, set `HEALTH_ALERT_ENABLED=false`.

### 3. Test it

Call the sweep endpoint with the secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://chmonitor.example.com/api/cron/health-sweep
```

The endpoint returns HTTP 200 and a JSON list of check results. Alerts are sent on the server, so check the Slack channel for the message. To force one, set `HEALTH_ALERT_MIN_SEVERITY=warning` and wait for a check that is above its threshold.

## Kubernetes with Helm

Keep the webhook URL in a Secret. Do not put it in `values.yaml`.

```bash
kubectl create secret generic chmonitor-alert-secrets \
  --from-literal=CRON_SECRET="$(openssl rand -hex 32)" \
  --from-literal=slack-webhook-url='https://hooks.slack.com/services/T000/B000/XXXX'
```

Then set the values:

```yaml
cron:
  enabled: true
  existingSecret: chmonitor-alert-secrets   # must contain CRON_SECRET

alertWebhooks:
  enabled: true
  targets:
    - name: team-slack
      format: slack
      minSeverity: warning
      urlFrom:
        name: chmonitor-alert-secrets
        key: slack-webhook-url

alerting:
  instanceName: prod-eu
  dashboardUrl: https://chmonitor.example.com
  metadata:
    team: data
    region: eu
```

The CronJob and the dashboard must read the same `CRON_SECRET`. If they differ, the sweep is rejected.

## What the message looks like

Each alert is one compact line next to a severity colour bar. Host, value and thresholds appear once:

```
🔴 CRITICAL  Stuck Merges · node-2 · 4 (warn 1, crit 3) · Open
🟢 RESOLVED  Stuck Merges · node-0 · 0 (warn 1, crit 3) · fired for 35 min · Open
```

- **Instance prefix:** `[prod-eu]` before the title, only when `instanceName` is set.
- **Open link:** shown when `dashboardUrl` is set. It opens `/health?host=<id>`, where the details are.
- **Second line, only when there is something to show:** runbook links and metadata, for example `Runbook · team=data · region=eu`.

A grouped digest uses the same line for each alert, under a summary header.

You can change the title and body. A target accepts `titleTemplate` and `textTemplate`. Variables are `{{severity}}`, `{{title}}`, `{{host}}`, `{{instance}}`, `{{meta.<key>}}` and more. Here is a title that puts the instance, severity and team first:

```yaml
    - name: team-slack
      format: slack
      titleTemplate: "[{{instance}}] {{severity}} {{title}} ({{host}}, team {{meta.team}})"
```

An unknown variable stays as written, so a typo is easy to see in the preview.

## Several deployments and several channels

**Many deployments, one channel.** Set `alerting.instanceName` in each deployment, for example `prod-eu` and `prod-us`. Each message then starts with `[prod-eu]`. Use `metadata` for extra labels.

**One channel per severity.** Add two targets. Each target has its own webhook and its own `minSeverity`:

```yaml
alertWebhooks:
  enabled: true
  targets:
    - name: slack-warnings
      format: slack
      minSeverity: warning
      urlFrom:
        name: chmonitor-alert-secrets
        key: slack-warnings-url
    - name: slack-critical
      format: slack
      minSeverity: critical
      urlFrom:
        name: chmonitor-alert-secrets
        key: slack-critical-url
```

## Less noise

- **Transition-only alerts.** A message is sent when a check changes state, for example `ok` to `warning`. A check that stays broken is not sent again on every run.
- **Reminders.** A broken check sends one reminder per `HEALTH_ALERT_COOLDOWN_MINUTES`. The default is 60. Set `0` to turn reminders off.
- **Hysteresis.** `HEALTH_HYSTERESIS_BREACHES` (default 1) sets how many bad runs fire an alert. `HEALTH_HYSTERESIS_CLEARS` (default 2) sets how many good runs clear it. A metric that flaps around a threshold then sends one alert and one recovery.
- **Pause.** `HEALTH_ALERT_ENABLED=false` stops all alerts. The URLs stay in place, so you can turn alerts back on.

## Set it up with an AI agent

Paste this into Claude Code. Replace the placeholders first.

```text
Set up chmonitor health alerts to Slack for this deployment.

Deployment type: <docker | cloudflare | kubernetes>
Namespace or Docker compose file: <PATH OR NAMESPACE>
Slack webhook URL: keep it out of files. Ask me for it, then store it with <SECRET STORE COMMAND>.
Minimum severity: <warning | critical>
Instance name: <INSTANCE_NAME>
Dashboard URL: <PUBLIC_DASHBOARD_URL>

Steps:
1. Read the health alert section at https://docs.chmonitor.dev/guide/guides/alerting-slack-discord.
2. Generate CRON_SECRET with openssl rand -hex 32. Store it as a secret, never in a committed file.
3. Set CRON_SECRET, HEALTH_ALERT_WEBHOOK_URL and HEALTH_ALERT_MIN_SEVERITY using the matching method for the deployment type.
4. For Kubernetes, put the webhook URL in the Secret <SECRET_NAME> under key <KEY_NAME>, and reference it with urlFrom. Set cron.enabled and alerting.instanceName.
5. Test with: curl -H "Authorization: Bearer $CRON_SECRET" <DASHBOARD_URL>/api/cron/health-sweep
6. Report which files changed. Do not print the secret values.
```

Secrets stay in a Secret. The agent should never write the webhook URL or `CRON_SECRET` into `values.yaml`, a ConfigMap or Git.

## Read more

- [Alerting to Slack and Discord](https://docs.chmonitor.dev/guide/guides/alerting-slack-discord)
- [Slack app](https://docs.chmonitor.dev/guide/guides/slack-app)
- [Health](https://docs.chmonitor.dev/guide/features/health)
- [Environment variables](https://docs.chmonitor.dev/reference/environment-variables)
- [Deploy on Kubernetes](https://docs.chmonitor.dev/operate/deploy/k8s)
