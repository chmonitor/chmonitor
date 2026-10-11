---
title: "Health alerts to any webhook, on Kubernetes"
description: "Send chmonitor health alerts to Slack, Discord or Matrix, and tell several ClickHouse deployments apart in one channel."
date: 2026-10-11
tag: Guide
author: duyetbot
---

You run more than one ClickHouse deployment. Prod in two regions, a staging cluster, maybe a test box. You want one alert channel for all of them. Then a message arrives that says "Disk usage high" and you ask: which one?

Recent releases fix this. Every alert can now say where it came from, link back to the right dashboard, and carry a few labels. This post shows the setup on Kubernetes with Helm.

## What changed

- **`hookshot` format.** matrix-hookshot expects a `{text, html}` body. Before, the Matrix `m.notice` body showed up in a Hookshot room as raw JSON. The new format sends `text`, `html` and a `username`.
- **Deployment identity.** Three settings add a prefix, a link and metadata to every channel:
  - `HEALTH_ALERT_INSTANCE_NAME` adds a prefix such as `[prod-eu]`.
  - `HEALTH_ALERT_DASHBOARD_URL` adds an "Open dashboard" link to `/health?host=N`.
  - `HEALTH_ALERT_METADATA` adds `key=value` pairs.
- **Template variables.** Title and body templates can use `{{instance}}`, `{{dashboardUrl}}` and `{{meta.key}}`.
- **Discord.** Alerts no longer ping `@everyone`.

## Helm setup

You need a working chmonitor release. If you do not have one yet, see [Deploy chmonitor on Kubernetes with Helm](/self-hosting-chmonitor-helm/).

### 1. Put the secrets in a Secret

A webhook URL is a credential. Keep it out of `values.yaml`.

```bash
kubectl create secret generic chmonitor-alert-secrets \
  --from-literal=slack-webhook-url='https://hooks.slack.com/services/T000/B000/XXXX'
```

### 2. Turn on the schedule

Health alerts come from a sweep that runs every 5 minutes. On Kubernetes the chart runs it as a CronJob. It is off by default.

```yaml
cron:
  enabled: true
  existingSecret: chmonitor-cron   # a Secret with a CRON_SECRET key
```

### 3. Add a webhook target

```yaml
alertWebhooks:
  enabled: true
  targets:
    - name: team-alerts
      format: slack          # auto | raw | slack | matrix | hookshot
      minSeverity: warning   # warning | critical
      urlFrom:
        name: chmonitor-alert-secrets
        key: slack-webhook-url
```

For a Hookshot room, use `format: hookshot` and not `matrix`. Hookshot posts any body without a `text` key as raw JSON.

### 4. Say which deployment this is

```yaml
alerting:
  instanceName: prod-eu
  dashboardUrl: https://chm.example.com
  metadata:
    team: data-platform
    region: eu-west-1
```

Use a public http(s) URL for `dashboardUrl`. Metadata allows up to 10 pairs, with values up to 128 characters. Do not put secrets in it.

Then apply it:

```bash
helm upgrade my-chm chmonitor/chmonitor -f values.yaml
```

## What an alert looks like

In Slack, the visible text is close to this:

```text
[prod-eu] [CRITICAL] Disk usage high
Disk usage on default is 93%
host prod-eu-1 · disk-usage-percent = 93 · team=data-platform · region=eu-west-1
Open dashboard
```

"Open dashboard" links to `https://chm.example.com/health?host=0`. A second deployment can now post into the same channel with `instanceName: staging`, and nobody has to guess.

## Test it

Run the health sweep once by hand from the CronJob:

```bash
kubectl create job --from=cronjob/my-chm-chmonitor-cron-health-sweep test-sweep
kubectl logs job/test-sweep
```

The CronJob is named `<release fullname>-cron-health-sweep`. Run `kubectl get cronjob` for the exact name. A sweep only sends a message when a check is over its threshold, so a healthy cluster stays quiet. Use **Send test** on the target in Health settings to check delivery on its own.

## Pause alerts

Pick the narrowest switch:

| Switch | What it stops |
|---|---|
| `HEALTH_ALERT_ENABLED=false` | All channels. Keeps the URLs. |
| `enabled: false` on a target | One webhook target. |
| `alertWebhooks.enabled=false` | All targets declared in Helm. |
| `cron.enabled=false` | The scheduled sweep. |
| Quiet hours, maintenance windows | A time window, set in Health settings. |

`HEALTH_ALERT_MIN_SEVERITY=critical` does not pause anything. It only drops warnings.

## Let an agent do it

Give this prompt to Claude Code or a similar agent that has `kubectl` and `helm` access to your cluster. Fill in the placeholders first.

```text
Set up chmonitor health alerts to a webhook on my Kubernetes deployment.

Release: <RELEASE_NAME> in namespace <NAMESPACE>, chart chmonitor/chmonitor.
Values file: <PATH_TO_VALUES_YAML>.

1. Create a Secret named chmonitor-alert-secrets in <NAMESPACE> with the key
   webhook-url set to <WEBHOOK_URL>. Secrets must stay in a Secret. Never write
   the webhook URL or any token into values.yaml, and never print them.
2. In values.yaml, set:
   - cron.enabled: true (with a CRON_SECRET from a Secret)
   - alertWebhooks.enabled: true, with one target named <TARGET_NAME>,
     format <FORMAT: slack | hookshot | matrix | raw | auto>,
     minSeverity <warning | critical>, and urlFrom pointing at the Secret key
   - alerting.instanceName: <INSTANCE_NAME>
   - alerting.dashboardUrl: <PUBLIC_DASHBOARD_URL>
   - alerting.metadata: <KEY>: <VALUE> pairs (max 10, no secrets)
   Use only keys that exist in the chart's values.yaml.
3. Run helm upgrade <RELEASE_NAME> chmonitor/chmonitor -n <NAMESPACE> -f <PATH_TO_VALUES_YAML>
   and wait for the rollout.
4. Trigger a test job from the health-sweep CronJob with
   kubectl create job --from=cronjob/... and show me its logs.
5. Ask me to confirm a message arrived in <CHANNEL>, with the instance prefix and
   an Open dashboard link. If none arrived, check the job logs and the target
   settings, and report what you found instead of guessing.
```

## Read more

- [Health alerts on Kubernetes](https://docs.chmonitor.dev/guide/guides/health-alerts-kubernetes)
- [Alerting to Slack and Discord](https://docs.chmonitor.dev/guide/guides/alerting-slack-discord)
- [Health](https://docs.chmonitor.dev/guide/features/health)
- [Deploy on Kubernetes](https://docs.chmonitor.dev/operate/deploy/k8s)
- [Environment variables](https://docs.chmonitor.dev/reference/environment-variables)
- [Slack app](https://docs.chmonitor.dev/guide/guides/slack-app)
