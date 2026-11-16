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
import {
  buildSlackLineChart,
  buildSlackSparkline,
  type SlackChartPoint,
} from './slack-chart'

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

interface SlackBlock {
  type: string
  text?: SlackTextObject
  elements?: SlackTextObject[]
}

interface SlackAttachment {
  color: string
  blocks: SlackBlock[]
}

/** Slack Incoming Webhook body: summary text + colour attachment with blocks. */
export interface SlackWebhookBody {
  text: string
  /** Top-level blocks: the digest text. Single alerts use the attachment. */
  blocks?: SlackBlock[]
  attachments: SlackAttachment[]
}

function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RESOLVED' : severity.toUpperCase()
}

function mrkdwnSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function mrkdwnContext(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

/**
 * Pack mrkdwn lines into as few `section` blocks as Slack's text limit
 * allows. A line longer than the limit is clipped on its own.
 */
export function slackSections(lines: readonly string[]): SlackBlock[] {
  const blocks: SlackBlock[] = []
  let chunk = ''
  for (const raw of lines) {
    const line = clip(raw, SLACK_SECTION_TEXT_MAX)
    if (chunk && chunk.length + 1 + line.length > SLACK_SECTION_TEXT_MAX) {
      blocks.push(mrkdwnSection(chunk))
      chunk = ''
    }
    chunk = chunk ? `${chunk}\n${line}` : line
  }
  if (chunk) blocks.push(mrkdwnSection(chunk))
  return blocks
}

/**
 * Join parts with middots, skipping any whole part that would push the text
 * past Slack's limit. Slicing the joined text could cut a `<url|label>` link.
 */
function joinWithin(parts: readonly string[]): string {
  let out = ''
  for (const part of parts) {
    const next = out ? `${out} · ${part}` : part
    if (next.length <= SLACK_SECTION_TEXT_MAX) out = next
  }
  return out
}

/** Runbook URLs and runbook actions as Slack links. */
function runbookLinks(payload: AlertPayload): string[] {
  return [
    ...(payload.runbookUrls ?? []).map((u) => `<${slackLinkUrl(u)}|Runbook>`),
    ...(payload.actions ?? [])
      .filter((a) => a.kind === 'runbook' && a.url)
      .map(
        (a) =>
          `<${slackLinkUrl(a.url as string)}|${escapeSlackMrkdwn(a.label)}>`
      ),
  ]
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

  const context = [
    ...runbookLinks(payload),
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

/** Up to {@link DIGEST_GROUP_EXAMPLES} distinct names, then `+N`. */
function namesText(names: readonly string[]): string {
  const unique = [...new Set(names)]
  const shown = unique.slice(0, DIGEST_GROUP_EXAMPLES)
  const rest = unique.length - shown.length
  return rest > 0 ? [...shown, `+${rest}`].join(', ') : shown.join(', ')
}

/**
 * The Since part. A lone finding keeps its full incident line (`still open,
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

/** Plain parts of one digest line for a (rule, severity) group. */
export interface SlackDigestRow {
  severity: AlertSeverity
  /** Rule title, with `(N)` when the group has more than one finding. */
  problem: string
  where: string
  since: string
}

/** The parts of one digest line: Problem, Where, Since. */
export function slackDigestRow(
  group: DigestGroup,
  options: { withHost?: boolean } = {}
): SlackDigestRow {
  const count = group.payloads.length
  const where = namesText(group.payloads.map((p) => p.label))
  const hosts = options.withHost
    ? namesText(group.payloads.map((p) => p.hostLabel))
    : ''
  return {
    severity: group.severity,
    problem: count > 1 ? `${group.title} (${count})` : group.title,
    where: hosts ? `${where} · ${hosts}` : where,
    since: sinceText(group),
  }
}

/**
 * One mrkdwn line per group, laid out like {@link slackCompactLine}, e.g.
 * `🟠 *WARNING*  Disk usage (3) · node-1, node-2, +1 · 2 h`. Each part is
 * clipped before escaping so a long name never cuts an entity in half.
 */
function slackDigestLine(row: SlackDigestRow): string {
  const emoji = SEVERITY_STYLE[row.severity].emoji
  const parts = [
    clip(row.problem, 150),
    clip(row.where, 200),
    clip(row.since, 80),
  ]
    .filter(Boolean)
    .map(escapeSlackMrkdwn)
  return `${emoji} *${heading(row.severity)}*  ${parts.join(' · ')}`
}

/** Most runbook links the digest footer shows. */
const DIGEST_FOOTER_RUNBOOKS = 3

/** `2026-07-18 04:20 UTC` from an ISO timestamp, or the input when unparsable. */
export function utcMinute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * The digest footer: one small gray `context` line with the dashboard link,
 * up to {@link DIGEST_FOOTER_RUNBOOKS} distinct runbooks, the deployment
 * identity and the sweep time. Links come only from the payloads.
 */
function slackDigestFooter(payloads: readonly AlertPayload[]): string {
  const parts: string[] = []
  const dashboardUrl = digestDashboardUrl(payloads)
  if (dashboardUrl) {
    parts.push(`<${slackLinkUrl(dashboardUrl)}|Open dashboard>`)
  }
  const runbooks = new Map<string, string>()
  for (const p of payloads) {
    for (const url of p.runbookUrls ?? []) {
      if (!runbooks.has(url)) runbooks.set(url, 'Runbook')
    }
    for (const a of p.actions ?? []) {
      if (a.kind === 'runbook' && a.url && !runbooks.has(a.url)) {
        runbooks.set(a.url, a.label)
      }
    }
  }
  for (const [url, label] of [...runbooks].slice(0, DIGEST_FOOTER_RUNBOOKS)) {
    parts.push(`<${slackLinkUrl(url)}|${escapeSlackMrkdwn(label)}>`)
  }
  const first = payloads[0]
  const identity = first ? identityLine(first) : ''
  if (identity) parts.push(escapeSlackMrkdwn(identity))
  const latest = payloads
    .map((p) => p.timestamp)
    .sort()
    .at(-1)
  if (latest) parts.push(escapeSlackMrkdwn(utcMinute(latest)))
  return parts.join(' · ')
}

/**
 * Build ONE Slack Incoming-Webhook body for a group of findings bound for the
 * same channel (feat #2663), as compact text: a bold summary line, one
 * mrkdwn line per (rule, severity) group (capped, with a final "…and N
 * more"), and a small gray footer with links and metadata. Lines are split
 * across `section` blocks so each stays inside Slack's text limit. The
 * top-level `text` is the notification fallback. Pure — no transport.
 */
export function buildSlackDigestBody(
  payloads: readonly AlertPayload[]
): SlackWebhookBody {
  const digest = summarizeDigest(payloads)
  const style = SEVERITY_STYLE[digest.topSeverity]
  const summary = `Health digest: ${escapeSlackMrkdwn(digest.summaryLine)} (${digest.total} alerts)`

  const groups = groupDigest(payloads)
  const shown = groups.slice(0, MAX_DIGEST_LINES)
  const withHost = !sharesOneHost(payloads)
  const lines = [
    `${style.emoji} *${escapeSlackMrkdwn(clip(digest.summaryLine, 200))}*`,
    ...shown.map((g) => slackDigestLine(slackDigestRow(g, { withHost }))),
  ]
  const hidden = groups
    .slice(MAX_DIGEST_LINES)
    .reduce((n, g) => n + g.payloads.length, 0)
  if (hidden > 0) lines.push(`_…and ${hidden} more_`)

  const blocks = slackSections(lines)
  const footer = slackDigestFooter(payloads)
  if (footer) blocks.push(mrkdwnContext(footer))

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

/** Most raw characters of an alert label the app messages show. */
const LABEL_MAX = 500

/** The small gray line under an app alert: runbooks, rule, metadata, time. */
function slackAlertFooter(payload: AlertPayload): SlackBlock {
  return mrkdwnContext(
    joinWithin([
      ...runbookLinks(payload),
      ...[
        payload.metric,
        ...metadataPairs(payload),
        utcMinute(payload.timestamp),
      ].map(escapeSlackMrkdwn),
    ])
  )
}

/**
 * One alert as the Slack app shows it, with no fields grid (Slack lays fields
 * out as a two-column table): the compact line, the detail, an optional
 * trend line and the dashboard diagnostics, then `extraBlocks` (the ack
 * button) and the footer.
 */
export function slackAlertBlocks<B>(
  payload: AlertPayload,
  extraBlocks: readonly B[] = [],
  trend = ''
): (SlackBlock | B)[] {
  const diagnostics = (payload.actions ?? [])
    .filter((a) => a.kind === 'diagnostic')
    .map((a) => escapeSlackMrkdwn(a.label))
  const lines = [
    slackCompactLine(payload),
    escapeSlackMrkdwn(clip(payload.label, LABEL_MAX)),
    trend,
    diagnostics.length
      ? `Diagnostics in the dashboard: ${diagnostics.join(' · ')}`
      : '',
  ].filter(Boolean)
  return [...slackSections(lines), ...extraBlocks, slackAlertFooter(payload)]
}

/**
 * The thread reply with the details the parent leaves out: value and
 * thresholds, detail, diagnostics, runbooks, rule and metadata.
 * `extraBlocks` (the ack button) go between the text and the footer.
 */
export function buildSlackBotDetails(
  payload: AlertPayload,
  extraBlocks: readonly unknown[] = []
): SlackBotMessage {
  return buildSlackBotTrend(payload, [], extraBlocks)
}

/**
 * {@link buildSlackBotDetails} plus the episode's timed values: a native
 * line chart under the text (see {@link buildSlackLineChart}), or, when
 * there are too few values for one or `chart` is false, a sparkline line
 * (see {@link buildSlackSparkline}). Nulls are skipped, and a series with no
 * number adds nothing. The chart title, legend and axis are plain strings,
 * not mrkdwn, so they are not escaped.
 */
export function buildSlackBotTrend(
  payload: AlertPayload,
  series: readonly SlackChartPoint[],
  extraBlocks: readonly unknown[] = [],
  options: { chart?: boolean } = {}
): SlackBotMessage {
  const thresholds = {
    warn: payload.warnThreshold,
    crit: payload.critThreshold,
  }
  const chart =
    options.chart === false
      ? null
      : buildSlackLineChart({
          title: payload.title,
          metric: payload.metric,
          points: series,
          ...thresholds,
        })
  return {
    text: escapeSlackMrkdwn(
      `Details: ${payload.title} on ${payload.hostLabel}`
    ),
    blocks: chart
      ? slackAlertBlocks(payload, [chart, ...extraBlocks])
      : slackAlertBlocks(
          payload,
          extraBlocks,
          buildSlackSparkline(
            series.map((p) => p.value),
            thresholds
          )
        ),
  }
}

/** The alert a resolution closes, as it first fired. */
export interface SlackOriginalAlert {
  title: string
  hostLabel: string
  /** ISO-8601 time the episode first fired. */
  firstFiredAt: string
  /** Value the alert fired with. */
  value: number | null
  /** Severity the alert fired with; the quote shows it when set. */
  severity?: 'warning' | 'critical'
  /** Highest value of the episode, when the caller knows it. */
  peak?: number | null
}

/** How long the incident fired, or undefined when unknown or impossible. */
function resolvedAfterMs(
  payload: AlertPayload,
  original: SlackOriginalAlert | undefined
): number | undefined {
  if (payload.firedForMs !== undefined) return payload.firedForMs
  if (!original) return undefined
  const ms = Date.parse(payload.timestamp) - Date.parse(original.firstFiredAt)
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined
}

/** The original alert as a Slack blockquote, one `> ` per line. */
function quoteLines(original: SlackOriginalAlert): string[] {
  const lead = original.severity
    ? `${SEVERITY_STYLE[original.severity].emoji} *${heading(original.severity)}*  `
    : ''
  const body = [
    original.title,
    original.hostLabel,
    valueText(original),
    `fired ${utcMinute(original.firstFiredAt)}`,
  ]
    .map(escapeSlackMrkdwn)
    .join(' · ')
  // Escaping first turns any `>` in the text into `&gt;`, so only these
  // prefixes open the quote; a newline in the text stays inside it.
  return `${lead}${body}`.split('\n').map((line) => `> ${line}`)
}

/**
 * The thread reply when an alert resolves: one RESOLVED line with how long it
 * fired, the peak (when known) and the last value, then the original alert
 * quoted so the reader sees what ended, then the footer. Without
 * `original` it is the RESOLVED line and the footer.
 */
export function buildSlackBotResolved(
  payload: AlertPayload,
  original?: SlackOriginalAlert
): SlackBotMessage {
  const firedForMs = resolvedAfterMs(payload, original)
  const peak = original?.peak
  const parts = [
    `${instancePrefix(payload)}${payload.title}`,
    payload.hostLabel,
    firedForMs === undefined ? '' : `resolved after ${spanText(firedForMs)}`,
    typeof peak === 'number' && Number.isFinite(peak) ? `peak ${peak}` : '',
    payload.value === null ? '' : `last ${payload.value}`,
  ]
    .filter(Boolean)
    .map(escapeSlackMrkdwn)
  if (payload.dashboardUrl) {
    parts.push(`<${slackLinkUrl(payload.dashboardUrl)}|Open>`)
  }
  const lines = [
    `${SEVERITY_STYLE.recovery.emoji} *${heading('recovery')}*  ${parts.join(' · ')}`,
    ...(original ? quoteLines(original) : []),
  ]
  return {
    text: escapeSlackMrkdwn(
      `Resolved: ${payload.title} on ${payload.hostLabel}`
    ),
    blocks: [...slackSections(lines), slackAlertFooter(payload)],
  }
}

/** Slack adapter. `buildBody` returns the Incoming Webhook JSON body. */
export const slackAdapter: NotificationAdapter = {
  id: 'slack',
  detect: (url: string) => /(?:^|\/\/)hooks\.slack\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildSlackBody(payload),
}
