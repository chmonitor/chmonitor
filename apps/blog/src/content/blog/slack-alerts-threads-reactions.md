---
title: "Slack alerts with threads, reactions and trend lines"
description: "Give chmonitor a Slack bot token and each incident becomes one Slack message that updates itself, with the details, a trend line, the ack and the resolution in its thread."
date: 2026-11-16
tag: Guide
author: duyetbot
---

An incoming webhook can only post new messages. One busy disk then means a warning, a critical and a resolved message, each on its own in the channel. With a Slack bot token, chmonitor keeps one message per alert route and edits it. Everything else about the incident goes in that message's thread.

**See it first.** [The Slack alert demo](/demo/slack-alerts/) follows one disk alert from the first warning to resolved. Every message on that page is the Block Kit JSON chmonitor sends, drawn as HTML, and the chart is drawn as SVG from the same chart block Slack gets. A test rebuilds that JSON from the alert code, so the demo stays true to what Slack receives.

## What the bot adds

- **One standing message.** It shows what is open, for example `🔴 1 open · 1 critical`, and chmonitor edits it on every sweep that changes the counts. When nothing is open it reads `✅ All clear`, and the next incident starts a new message.
- **Details in the thread.** The value against both thresholds, what was measured, the runbook link and an **Acknowledge** button. The rule id, your metadata and the time go in a small gray footer line, not in a table.
- **A trend line.** The reply carries a line chart of recent readings with the warn and crit levels. It is Slack's native chart block, `data_visualization`, so Slack draws the chart itself. Slack's [block reference](https://docs.slack.dev/reference/block-kit/blocks/data-visualization-block/) does not say whether incoming webhooks or older app installs can post it, and we have not yet tried it against a live workspace.
- **Reactions.** The bot adds 👀 to an alert when someone acknowledges it and ✅ when it resolves.
- **A resolved reply.** It says how long the alert lasted and its peak, then quotes the alert as it first fired.
- **Your name and icon.** Posts carry the name in `SLACK_BOT_NAME`, which defaults to the instance name, and the icon in `SLACK_BOT_ICON_EMOJI`.

## What you need

- A chmonitor deployment with a metadata database. chmonitor stores the standing message's id there, so it can edit the message later.
- A Slack app with the bot scopes `chat:write`, `chat:write.customize` and `reactions:write`. The [app manifest](https://github.com/chmonitor/chmonitor/blob/main/docs/slack/manifest.yml) in the repo has all three.
- An alert route with a Slack incoming-webhook URL. The webhook stays as the fallback.

## Set it up

### 1. Create the Slack app

1. Open [api.slack.com/apps](https://api.slack.com/apps), click **Create New App** and pick **From an app manifest**.
2. Paste [`docs/slack/manifest.yml`](https://github.com/chmonitor/chmonitor/blob/main/docs/slack/manifest.yml). Replace every `dash.chmonitor.dev` in it with your own host. If you only need alerts, delete the slash command, events and interactivity sections instead.
3. Click **Install to Workspace**, then copy the **Bot User OAuth Token**. It starts with `xoxb-`.

### 2. Set the token, name and icon

```bash
SLACK_BOT_TOKEN=xoxb-...                # a secret, never commit it
SLACK_BOT_NAME="chmonitor prod-eu"      # optional
SLACK_BOT_ICON_EMOJI=:rotating_light:   # optional
```

The token is a secret. Store it as a Worker secret (`bun scripts/set-secrets.ts`), in `.env.local`, or in a Kubernetes Secret. With Helm:

```yaml
extraEnv:
  - name: SLACK_BOT_TOKEN
    valueFrom:
      secretKeyRef:
        name: chmonitor-alert-secrets
        key: slack-bot-token
```

### 3. Invite the bot and copy the channel id

Run `/invite @chmonitor` in the channel. Without the invite, Slack answers `not_in_channel` and the alert goes out through the webhook.

Then open the channel details in Slack. The id at the bottom looks like `C0123456789`. A channel name such as `#alerts` does not work here.

### 4. Add the channel id to the route

In the dashboard, the **Slack channel id** field shows once the route URL is a `hooks.slack.com` URL. In `routing.yaml`:

```yaml
routes:
  - id: slack-alerts
    provider: webhook
    secretEnv: SLACK_ALERTS_WEBHOOK_URL
    target:
      slackChannelId: C0123456789
```

## When something is missing

When Slack refuses one of the extras, chmonitor drops that extra and still sends the alert:

- **No `chat:write.customize`.** Alerts still post, under the app's own name and icon.
- **No `reactions:write`.** chmonitor skips the reaction and still posts the message.
- **An older install.** An app installed before these scopes were added keeps its old scopes until you reinstall it.
- **No token, no metadata database, or a Slack API error.** The alert goes through the webhook exactly as before, and chmonitor logs the error. The webhook message has no chart.

## Verifying it worked

Call the sweep endpoint with your cron secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://chmonitor.example.com/api/cron/health-sweep
```

The endpoint returns HTTP 200 and sends alerts on the server. When a check is over its threshold, the channel gets one message from your bot with the open count, and the details in its thread. If you see a plain webhook message instead, check the bot invite and the channel id first.

## Related

- [The Slack alert demo](/demo/slack-alerts/)
- [Send chmonitor health alerts to Slack](/slack-alerts/), the webhook guide
- Docs: [Slack bot delivery](https://docs.chmonitor.dev/guide/guides/alerting-slack-discord#slack-bot-one-standing-message-changes-in-its-thread)
- Docs: [Slack app](https://docs.chmonitor.dev/guide/guides/slack-app)
