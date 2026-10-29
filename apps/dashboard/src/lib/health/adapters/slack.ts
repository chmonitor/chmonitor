/**
 * Slack notification adapter (pure formatter).
 *
 * Builds an Incoming-Webhook payload using Block Kit blocks for the body plus a
 * colour-coded attachment (the classic left-border colour bar) keyed off
 * severity. The result is the JSON body POSTed to a Slack webhook URL; the URL
 * itself comes from caller configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import {
  incidentLine,
  MAX_DIGEST_LINES,
  spanText,
  summarizeDigest,
} from './digest'
import { thresholdParts, valueText } from './facts'
import {
  digestDashboardUrl,
  identityLine,
  instancePrefix,
  metadataPairs,
} from './identity'

/** Escape operator-controlled text before putting it in Slack mrkdwn. */
export function escapeSlackMrkdwn(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Make a URL safe inside Slack's `<url>` link syntax: `<`, `>` and `|` would end or split the link. */
function slackLinkUrl(url: string): string {
  return escapeSlackMrkdwn(url.replace(/\|/g, '%7C'))
}

/** Slack Block Kit limits a grouped message must stay inside. */
export const SLACK_SECTION_TEXT_MAX = 3000
export const SLACK_HEADER_TEXT_MAX = 150
export const SLACK_BLOCKS_MAX = 50

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

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
  return severity === 'recovery' ? 'RESOLVED' : severity.toUpperCase()
}

/** Plain pieces of the compact line, in order; callers escape and join. */
function compactParts(
  payload: AlertPayload,
  withPrefix: boolean
): { lead: string; facts: string[] } {
  const thresholds = thresholdParts(payload)
  const value = thresholds.length
    ? `${valueText(payload)} (${thresholds.join(', ')})`
    : valueText(payload)
  const incident = incidentLine(payload)
  return {
    lead: `${withPrefix ? instancePrefix(payload) : ''}${payload.title}`,
    facts: [payload.hostLabel, value, ...(incident ? [incident] : [])],
  }
}

/**
 * One compact mrkdwn line per alert (#4241), e.g.
 * `🔴 *CRITICAL*  Stuck Merges · node-2 · 4 (warn 1, crit 3) · <url|Open>`.
 * Host, value and thresholds appear once; the instance prefix only when set.
 */
export function slackCompactLine(
  payload: AlertPayload,
  options: { withPrefix?: boolean; withLink?: boolean } = {}
): string {
  const { lead, facts } = compactParts(payload, options.withPrefix ?? true)
  const parts = [lead, ...facts].map(escapeSlackMrkdwn)
  if ((options.withLink ?? true) && payload.dashboardUrl) {
    parts.push(`<${slackLinkUrl(payload.dashboardUrl)}|Open>`)
  }
  const style = SEVERITY_STYLE[payload.severity]
  return `${style.emoji} *${heading(payload.severity)}*  ${parts.join(' · ')}`
}

/**
 * Build the Slack webhook body for a payload: one compact line beside the
 * severity colour bar, plus one small context line only when there are
 * runbooks or deployment metadata to show. The top-level `text` is the
 * plain-text notification fallback.
 */
export function buildSlackBody(payload: AlertPayload): SlackWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]
  const { lead, facts } = compactParts(payload, true)
  const summary = escapeSlackMrkdwn(
    `${style.emoji} ${heading(payload.severity)}  ${[lead, ...facts].join(' · ')}`
  )

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: slackCompactLine(payload) },
    },
  ]

  const links = [
    ...(payload.runbookUrls ?? []).map((u) => `<${slackLinkUrl(u)}|Runbook>`),
    ...(payload.actions ?? [])
      .filter((a) => a.kind === 'runbook' && a.url)
      .map(
        (a) =>
          `<${slackLinkUrl(a.url as string)}|${escapeSlackMrkdwn(a.label)}>`
      ),
  ]
  const context = [
    ...links,
    ...metadataPairs(payload).map(escapeSlackMrkdwn),
  ].join(' · ')
  if (context) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: context }],
    })
  }

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
  const summary = `Health digest: ${escapeSlackMrkdwn(digest.summaryLine)} (${digest.total} alerts)`

  // Fit the list into one section: drop trailing lines (counted into the
  // "…and N more" overflow line) until it is within Slack's text limit.
  // Same compact line as a single alert; the header already carries the
  // instance prefix and the digest has one dashboard button.
  const lines = payloads
    .slice(0, MAX_DIGEST_LINES)
    .map((p) => slackCompactLine(p, { withPrefix: false, withLink: false }))
  const render = (kept: number): string => {
    const hidden = digest.overflow + (lines.length - kept)
    const out = lines.slice(0, kept)
    if (hidden > 0) out.push(`…and ${hidden} more`)
    return out.join('\n')
  }
  let kept = lines.length
  while (kept > 1 && render(kept).length > SLACK_SECTION_TEXT_MAX) kept--
  const listText = clip(render(kept), SLACK_SECTION_TEXT_MAX)

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: clip(
          `${style.emoji} Health digest: ${digest.summaryLine}`,
          SLACK_HEADER_TEXT_MAX
        ),
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: listText },
    },
  ]

  const dashboardUrl = digestDashboardUrl(payloads)
  if (dashboardUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open dashboard', emoji: true },
          url: dashboardUrl,
        },
      ],
    })
  }

  return {
    text: summary,
    attachments: [{ color: style.color, blocks }],
  }
}

// --- Bot delivery (#4241): parent line + thread details ---------------------

/** A `chat.postMessage` / `chat.update` body (channel and ts added by the caller). */
export interface SlackBotMessage {
  text?: string
  blocks?: unknown[]
  attachments?: { color: string; fallback: string; blocks: SlackBlock[] }[]
}

/** Plain notification text for a payload (no mrkdwn). */
function plainSummary(payload: AlertPayload, heading: string): string {
  const { lead, facts } = compactParts(payload, true)
  return `${heading}  ${[lead, ...facts].join(' · ')}`
}

/**
 * The thread parent: the compact line beside the severity colour bar.
 *
 * No top-level `text`: Slack shows top-level `text` as the message body when
 * there are no top-level `blocks`, so it would repeat the line above the
 * attachment. The attachment `fallback` is the notification text instead.
 */
export function buildSlackBotParent(payload: AlertPayload): SlackBotMessage {
  const style = SEVERITY_STYLE[payload.severity]
  return {
    attachments: [
      {
        color: style.color,
        fallback: plainSummary(
          payload,
          `${style.emoji} ${heading(payload.severity)}`
        ),
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: slackCompactLine(payload) },
          },
        ],
      },
    ],
  }
}

/** The parent after recovery: `✅ *RESOLVED* …`, green bar. */
export function buildSlackBotResolvedParent(
  payload: AlertPayload
): SlackBotMessage {
  const recovered: AlertPayload = { ...payload, severity: 'recovery' }
  const line = slackCompactLine(recovered).replace(
    SEVERITY_STYLE.recovery.emoji,
    '✅'
  )
  return {
    attachments: [
      {
        color: SEVERITY_STYLE.recovery.color,
        fallback: plainSummary(recovered, '✅ RESOLVED'),
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: line } }],
      },
    ],
  }
}

/**
 * The thread reply with the details the parent leaves out: host, metric,
 * value and thresholds, detail, status, runbooks, diagnostics, identity.
 * `extraBlocks` (the ack button) are appended before the timestamp.
 */
export function buildSlackBotDetails(
  payload: AlertPayload,
  extraBlocks: readonly unknown[] = []
): SlackBotMessage {
  const thresholds = thresholdParts(payload)
  const field = (label: string, value: string) => ({
    type: 'mrkdwn' as const,
    text: clip(`*${label}:*\n${escapeSlackMrkdwn(value)}`, 2000),
  })
  const blocks: unknown[] = [
    {
      type: 'section',
      fields: [
        field('Host', `${payload.hostLabel} (id ${payload.hostId})`),
        field('Metric', payload.metric),
        field(
          'Value',
          thresholds.length
            ? `${valueText(payload)} (${thresholds.join(', ')})`
            : valueText(payload)
        ),
        field('Detail', payload.label),
      ],
    },
  ]
  const status = incidentLine(payload)
  if (status) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `*Status:* ${escapeSlackMrkdwn(status)}` },
      ],
    })
  }
  const runbooks = [
    ...(payload.runbookUrls ?? []).map((u) => `<${slackLinkUrl(u)}|Runbook>`),
    ...(payload.actions ?? [])
      .filter((a) => a.kind === 'runbook' && a.url)
      .map(
        (a) =>
          `<${slackLinkUrl(a.url as string)}|${escapeSlackMrkdwn(a.label)}>`
      ),
  ]
  if (runbooks.length) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: runbooks.join(' · ') }],
    })
  }
  const diagnostics = (payload.actions ?? [])
    .filter((a) => a.kind === 'diagnostic')
    .map((a) => escapeSlackMrkdwn(a.label))
  if (diagnostics.length) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Diagnostics in the dashboard:* ${diagnostics.join(' · ')}`,
        },
      ],
    })
  }
  const identity = identityLine(payload)
  if (identity) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: escapeSlackMrkdwn(identity) }],
    })
  }
  blocks.push(...extraBlocks)
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: escapeSlackMrkdwn(payload.timestamp) }],
  })
  return {
    text: `Details: ${payload.title} on ${payload.hostLabel}`,
    blocks,
  }
}

/** The thread reply on recovery: `✅ resolved after N min`. */
export function buildSlackBotResolvedReply(
  payload: AlertPayload
): SlackBotMessage {
  const text =
    payload.firedForMs !== undefined
      ? `✅ resolved after ${spanText(payload.firedForMs)}`
      : '✅ resolved'
  return { text }
}

/** Slack adapter. `buildBody` returns the Incoming Webhook JSON body. */
export const slackAdapter: NotificationAdapter = {
  id: 'slack',
  detect: (url: string) => /(?:^|\/\/)hooks\.slack\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildSlackBody(payload),
}
