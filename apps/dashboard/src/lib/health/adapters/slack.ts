/**
 * Slack notification adapter (pure formatter).
 *
 * Builds an Incoming-Webhook payload using Block Kit blocks for the body plus a
 * colour-coded attachment (the classic left-border colour bar) keyed off
 * severity. The result is the JSON body POSTed to a Slack webhook URL; the URL
 * itself comes from caller configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import { summarizeDigest } from './digest'

/** Severity → attachment colour (hex) and header emoji. */
const SEVERITY_STYLE: Record<AlertSeverity, { color: string; emoji: string }> =
  {
    critical: { color: '#dc2626', emoji: '🔴' },
    warning: { color: '#f59e0b', emoji: '🟠' },
    recovery: { color: '#16a34a', emoji: '🟢' },
  }

interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn'
  text: string
  emoji?: boolean
}

interface SlackButtonElement {
  type: 'button'
  text: SlackTextObject
  /** Link-out button (runbook actions) — no interaction round-trip required. */
  url: string
}

interface SlackBlock {
  type: string
  text?: SlackTextObject
  fields?: SlackTextObject[]
  elements?: (SlackTextObject | SlackButtonElement)[]
}

interface SlackAttachment {
  color: string
  blocks: SlackBlock[]
}

/** Slack Incoming Webhook body: summary text + colour attachment with blocks. */
export interface SlackWebhookBody {
  text: string
  attachments: SlackAttachment[]
}

function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
}

function thresholdText(payload: AlertPayload): string {
  const parts: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    parts.push(`warn ${payload.warnThreshold}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    parts.push(`crit ${payload.critThreshold}`)
  }
  return parts.length > 0 ? parts.join(' | ') : '—'
}

/**
 * Build the Slack webhook body for a payload.
 */
export function buildSlackBody(payload: AlertPayload): SlackWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]
  const summary = `[${heading(payload.severity)}] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${style.emoji} ${heading(payload.severity)}: ${payload.title}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Host:*\n${payload.hostLabel} (id ${payload.hostId})`,
        },
        { type: 'mrkdwn', text: `*Metric:*\n${payload.metric}` },
        {
          type: 'mrkdwn',
          text: `*Value:*\n${payload.value === null ? 'n/a' : payload.value}`,
        },
        { type: 'mrkdwn', text: `*Thresholds:*\n${thresholdText(payload)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Detail:* ${payload.label}` },
    },
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Runbooks:*\n${payload.runbookUrls.map((u) => `• <${u}>`).join('\n')}`,
      },
    })
  }

  // Remediation actions (plans/33-remediation-action-links.md). Runbook
  // actions render as Slack link buttons (no interactivity needed — Incoming
  // Webhooks support `url` buttons out of the box). Diagnostic actions are
  // READ-ONLY and executable via `POST /api/v1/health/actions`, but wiring a
  // one-click Slack button to that endpoint requires an interactive Slack App
  // request URL (plan 37) — a plain Incoming Webhook cannot receive the click.
  // Until then, list diagnostics as plain text so the operator knows they
  // exist and can trigger them from the in-app Active Alerts panel.
  const runbookActions = (payload.actions ?? []).filter(
    (a) => a.kind === 'runbook' && a.url
  )
  const diagnosticActions = (payload.actions ?? []).filter(
    (a) => a.kind === 'diagnostic'
  )

  if (runbookActions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: runbookActions.map((a) => ({
        type: 'button',
        text: { type: 'plain_text', text: a.label, emoji: true },
        url: a.url as string,
      })),
    })
  }

  if (diagnosticActions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Diagnostics available:*\n${diagnosticActions.map((a) => `• ${a.label} — run from the Active Alerts panel`).join('\n')}`,
      },
    })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: payload.timestamp }],
  })

  return {
    text: summary,
    attachments: [{ color: style.color, blocks }],
  }
}

/**
 * Build ONE Slack Incoming-Webhook body for a group of findings bound for the
 * same channel (feat #2663). The header carries the summary line, a single
 * section lists every finding (capped, with a "…and N more" overflow line), and
 * the attachment colour tracks the group's highest severity. Pure — no
 * transport.
 */
export function buildSlackDigestBody(
  payloads: readonly AlertPayload[]
): SlackWebhookBody {
  const digest = summarizeDigest(payloads)
  const style = SEVERITY_STYLE[digest.topSeverity]
  const summary = `Health digest: ${digest.summaryLine} (${digest.total} alerts)`

  const listLines = digest.findingLines.map((line) => `• ${line}`)
  if (digest.overflow > 0) {
    listLines.push(`…and ${digest.overflow} more`)
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${style.emoji} Health digest: ${digest.summaryLine}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: listLines.join('\n') },
    },
  ]

  return {
    text: summary,
    attachments: [{ color: style.color, blocks }],
  }
}

/** Slack adapter. `buildBody` returns the Incoming Webhook JSON body. */
export const slackAdapter: NotificationAdapter = {
  id: 'slack',
  detect: (url: string) => /(?:^|\/\/)hooks\.slack\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildSlackBody(payload),
}
