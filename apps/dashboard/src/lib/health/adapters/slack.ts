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
  DIGEST_GROUP_EXAMPLES,
  type DigestDelta,
  type DigestGroup,
  digestDeltaLine,
  groupDigest,
  incidentLine,
  MAX_DIGEST_LINES,
  sharesOneHost,
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
  column_settings?: { is_wrapped?: boolean }[]
  rows?: SlackTableCell[][]
}

interface SlackAttachment {
  color: string
  blocks: SlackBlock[]
}

/** Slack Incoming Webhook body: summary text + colour attachment with blocks. */
export interface SlackWebhookBody {
  text: string
  /** Top-level blocks: the digest table. Single alerts use the attachment. */
  blocks?: SlackBlock[]
  attachments: SlackAttachment[]
}

function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RESOLVED' : severity.toUpperCase()
}

/** Plain pieces of the compact line, in order; callers escape and join. */
function compactParts(
  payload: AlertPayload,
  withPrefix: boolean,
  withHost = true
): { lead: string; facts: string[] } {
  const thresholds = thresholdParts(payload)
  const value = thresholds.length
    ? `${valueText(payload)} (${thresholds.join(', ')})`
    : valueText(payload)
  const incident = incidentLine(payload)
  return {
    lead: `${withPrefix ? instancePrefix(payload) : ''}${payload.title}`,
    facts: [
      ...(withHost ? [payload.hostLabel] : []),
      value,
      ...(incident ? [incident] : []),
    ],
  }
}

/**
 * One compact mrkdwn line per alert (#4241), e.g.
 * `🔴 *CRITICAL*  Stuck Merges · node-2 · 4 (warn 1, crit 3) · <url|Open>`.
 * Host, value and thresholds appear once; the instance prefix only when set.
 */
export function slackCompactLine(
  payload: AlertPayload,
  options: { withPrefix?: boolean; withLink?: boolean; withHost?: boolean } = {}
): string {
  const { lead, facts } = compactParts(
    payload,
    options.withPrefix ?? true,
    options.withHost ?? true
  )
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

/** Slack table block limits (docs.slack.dev/reference/block-kit/blocks/table-block). */
export const SLACK_TABLE_ROWS_MAX = 100
export const SLACK_TABLE_CHARS_MAX = 10_000

interface SlackTableCell {
  type: 'raw_text'
  text: string
}

/** Up to {@link DIGEST_GROUP_EXAMPLES} distinct names, then `+N`. */
function namesText(names: readonly string[]): string {
  const unique = [...new Set(names)]
  const shown = unique.slice(0, DIGEST_GROUP_EXAMPLES)
  const rest = unique.length - shown.length
  return rest > 0 ? [...shown, `+${rest}`].join(', ') : shown.join(', ')
}

/**
 * The Since cell. A lone finding keeps its full incident line (`still open,
 * 3 h (88.5 -> 97.25)`, `fired for 3 h`); a group shows its oldest finding's
 * age. A finding with no timeline is new in this sweep.
 */
function sinceText(group: DigestGroup): string {
  if (group.payloads.length === 1) {
    return incidentLine(group.payloads[0]) || 'new'
  }
  const longest = (ms: (number | undefined)[]) =>
    Math.max(...ms.filter((m): m is number => m !== undefined))
  const open = longest(group.payloads.map((p) => p.stillOpenMs))
  if (Number.isFinite(open)) return spanText(open)
  const fired = longest(group.payloads.map((p) => p.firedForMs))
  return Number.isFinite(fired) ? `fired for ${spanText(fired)}` : 'new'
}

/** One digest table row for a (rule, severity) group: Status, Problem, Where, Since. */
export function slackDigestTableRow(
  group: DigestGroup,
  options: { withHost?: boolean } = {}
): string[] {
  const count = group.payloads.length
  const where = namesText(group.payloads.map((p) => p.label))
  const hosts = options.withHost
    ? namesText(group.payloads.map((p) => p.hostLabel))
    : ''
  return [
    `${SEVERITY_STYLE[group.severity].emoji} ${heading(group.severity)}`,
    count > 1 ? `${group.title} (${count})` : group.title,
    hosts ? `${where} · ${hosts}` : where,
    sinceText(group),
  ]
}

const DIGEST_TABLE_HEADER = ['Status', 'Problem', 'Where', 'Since']

/**
 * Build ONE Slack Incoming-Webhook body for a group of findings bound for the
 * same channel (feat #2663): a header with the summary line, a Block Kit
 * `table` with one row per (rule, severity) group (capped, with a final
 * "…and N more" row), and the dashboard button. Slack documents the table for
 * top-level `blocks`, so the digest has no colour attachment. The top-level
 * `text` is the notification and no-table-client fallback. Pure — no transport.
 */
export function buildSlackDigestBody(
  payloads: readonly AlertPayload[]
): SlackWebhookBody {
  const digest = summarizeDigest(payloads)
  const style = SEVERITY_STYLE[digest.topSeverity]
  const summary = `Health digest: ${escapeSlackMrkdwn(digest.summaryLine)} (${digest.total} alerts)`

  // Header row + data rows + overflow row must fit Slack's row limit; drop
  // trailing rows (counted into "…and N more") until the cells fit its
  // character limit.
  const groups = groupDigest(payloads).slice(
    0,
    Math.min(MAX_DIGEST_LINES, SLACK_TABLE_ROWS_MAX - 2)
  )
  const withHost = !sharesOneHost(payloads)
  const rows = groups.map((g) =>
    slackDigestTableRow(g, { withHost }).map((cell) =>
      clip(escapeSlackMrkdwn(cell), 300)
    )
  )
  const render = (kept: number): string[][] => {
    const shown = groups
      .slice(0, kept)
      .reduce((n, g) => n + g.payloads.length, 0)
    const hidden = digest.total - shown
    const out = [DIGEST_TABLE_HEADER, ...rows.slice(0, kept)]
    if (hidden > 0) out.push([`…and ${hidden} more`, '', '', ''])
    return out
  }
  const chars = (table: string[][]) =>
    table.flat().reduce((n, cell) => n + cell.length, 0)
  let kept = rows.length
  while (kept > 1 && chars(render(kept)) > SLACK_TABLE_CHARS_MAX) kept--

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
      type: 'table',
      column_settings: [
        { is_wrapped: false },
        { is_wrapped: true },
        { is_wrapped: true },
        { is_wrapped: false },
      ],
      rows: render(kept).map((row) =>
        row.map((text): SlackTableCell => ({ type: 'raw_text', text }))
      ),
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

  return { text: summary, blocks, attachments: [] }
}
/** Slack body for a sweep that only added to open rules or only resolved: one line (#4246). */
export function buildSlackDeltaBody(
  delta: DigestDelta,
  payload: Partial<AlertPayload> = {}
): SlackWebhookBody {
  const line = digestDeltaLine(delta, payload)
  return {
    text: escapeSlackMrkdwn(line),
    attachments: [],
  }
}

// --- Bot delivery (#4241): parent line + thread details ---------------------

/** A `chat.postMessage` / `chat.update` body (channel and ts added by the caller). */
export interface SlackBotMessage {
  text?: string
  blocks?: unknown[]
  attachments?: { color: string; fallback: string; blocks: SlackBlock[] }[]
}

/** Open findings by severity: what the standing message shows. */
export interface SlackOpenCounts {
  critical: number
  warning: number
}

/**
 * The standing message (#4246): one colour-barred line with today's open
 * counts, edited in place each sweep. With nothing open it reads `✅ All
 * clear`, green. No top-level `text`: Slack would repeat it above the
 * attachment, so the attachment `fallback` is the notification text.
 */
export function buildSlackBotStandingParent(
  counts: SlackOpenCounts
): SlackBotMessage {
  const open = counts.critical + counts.warning
  if (open === 0) {
    return {
      attachments: [
        {
          color: SEVERITY_STYLE.recovery.color,
          fallback: '✅ All clear: no open alerts',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '✅ *All clear* · no open alerts' },
            },
          ],
        },
      ],
    }
  }
  const top: AlertSeverity = counts.critical > 0 ? 'critical' : 'warning'
  const parts = [
    counts.critical > 0 ? `${counts.critical} critical` : '',
    counts.warning > 0 ? `${counts.warning} warning` : '',
  ].filter(Boolean)
  const style = SEVERITY_STYLE[top]
  return {
    attachments: [
      {
        color: style.color,
        fallback: `${style.emoji} ${open} open: ${parts.join(', ')}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${style.emoji} *${open} open* · ${parts.join(' · ')}`,
            },
          },
        ],
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

/** Slack adapter. `buildBody` returns the Incoming Webhook JSON body. */
export const slackAdapter: NotificationAdapter = {
  id: 'slack',
  detect: (url: string) => /(?:^|\/\/)hooks\.slack\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildSlackBody(payload),
}
