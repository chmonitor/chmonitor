/**
 * Slack Block Kit builders for the native app (PURE — no network, no env).
 *
 * Every function here turns chmonitor data into the JSON block payloads Slack
 * renders, and is trivially unit-testable. Transport (posting to Slack, tokens,
 * response_url) lives in the route handlers / api.ts, never here — mirroring the
 * pure-formatter split already used by lib/health/adapters/slack.ts.
 *
 * Type-only imports of the chmonitor data shapes keep this a leaf module with
 * no runtime dependency on the Worker/D1 layers those shapes come from.
 */

import type { AlertPayload, AlertSeverity } from '@/lib/health/adapters/types'
import type { AlertEventRecord } from '@/lib/health/alert-history-store'
import type { IncidentSnapshot } from '@/lib/health/incident-snapshot'

import {
  escapeSlackMrkdwn,
  slackAlertBlocks,
  slackSections,
  utcMinute,
} from '@/lib/health/adapters/slack'

export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn'
  text: string
  emoji?: boolean
}

export interface SlackButtonElement {
  type: 'button'
  text: SlackTextObject
  action_id: string
  value?: string
  url?: string
  style?: 'primary' | 'danger'
}

export interface SlackBlock {
  type: string
  text?: SlackTextObject
  elements?: (SlackTextObject | SlackButtonElement)[]
  block_id?: string
}

/** A Home-tab view published via `views.publish`. */
export interface SlackHomeView {
  type: 'home'
  blocks: SlackBlock[]
}

/**
 * The `action_id` carried by the "Acknowledge" button on pushed alert
 * messages. The interactions route matches on this exact id.
 */
export const ACK_ACTION_ID = 'chmonitor_ack_alert'

/** Slack caps a button `value` at 2000 chars; our encoded key is far smaller. */
const MAX_ACTION_VALUE = 2000

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: '🔴',
  warning: '🟠',
  recovery: '🟢',
}

/** Structured identity of the alert an ACK button refers to. */
export interface AckKey {
  /** Numeric host id. */
  hostId: number
  /** Rule / metric id (the alert-state dedup key component). */
  ruleId: string
  /** Severity at the time the alert was posted. */
  severity: AlertSeverity
}

/**
 * Encode an {@link AckKey} into a compact JSON string for a button `value`.
 * Throws if it would exceed Slack's 2000-char cap (impossible for real rule
 * ids, but guarded so a pathological id fails loud instead of being silently
 * truncated by Slack).
 */
export function encodeAckValue(key: AckKey): string {
  const value = JSON.stringify({
    h: key.hostId,
    r: key.ruleId,
    s: key.severity,
  })
  if (value.length > MAX_ACTION_VALUE) {
    throw new Error('ACK button value exceeds Slack 2000-char limit')
  }
  return value
}

/** Decode a button `value` back into an {@link AckKey}, or null if malformed. */
export function decodeAckValue(
  value: string | undefined | null
): AckKey | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as {
      h?: unknown
      r?: unknown
      s?: unknown
    }
    const hostId = Number(parsed.h)
    const ruleId = typeof parsed.r === 'string' ? parsed.r : ''
    const severity = parsed.s
    if (!Number.isInteger(hostId) || hostId < 0 || !ruleId) return null
    if (
      severity !== 'warning' &&
      severity !== 'critical' &&
      severity !== 'recovery'
    ) {
      return null
    }
    return { hostId, ruleId, severity }
  } catch {
    return null
  }
}

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function section(mrkdwn: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: mrkdwn } }
}

function context(mrkdwn: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: mrkdwn }] }
}

const divider: SlackBlock = { type: 'divider' }

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)}%`
}

/**
 * Cluster status summary blocks from an incident snapshot (running queries,
 * merges, memory/disk pressure, replication lag): a bold lead, one line of
 * facts and the capture time. A fact whose query failed reads "n/a" rather
 * than being omitted.
 */
export function buildStatusBlocks(
  hostLabel: string,
  snapshot: IncidentSnapshot
): SlackBlock[] {
  const merges = snapshot.merges
  const facts = [
    `Memory ${pct(snapshot.memoryUsagePct)}`,
    `Disk ${pct(snapshot.diskUsagePct)}`,
    `Running queries ${snapshot.topQueries?.length ?? 'n/a'}`,
    `Active merges ${merges ? `${merges.active}${merges.stuck > 0 ? ` (${merges.stuck} stuck)` : ''}` : 'n/a'}`,
    `Replication lag ${snapshot.replicationLagSeconds === null ? 'n/a' : `${snapshot.replicationLagSeconds}s`}`,
  ]

  return [
    section(
      `📊 *Cluster status*  ${escapeSlackMrkdwn(hostLabel)}\n${facts.join(' · ')}`
    ),
    context(`Captured ${escapeSlackMrkdwn(utcMinute(snapshot.capturedAt))}`),
  ]
}

/** Columns a result row shows before the rest are only counted. */
const MAX_RESULT_COLUMNS = 8

/**
 * Render a capped result set as compact lines, one per row: the first column
 * bold as the row's lead, the other columns as `name value` facts, and the
 * SQL in the footer. Cells come from the cluster, so each is escaped. The
 * caller enforces the row/time caps at query time; `rowCap` here only
 * controls how many are shown.
 */
export function buildQueryResultBlocks(
  sql: string,
  rows: Array<Record<string, unknown>>,
  opts: { rowCap: number; durationMs?: number; truncated?: boolean } = {
    rowCap: 20,
  }
): SlackBlock[] {
  const shown = rows.slice(0, opts.rowCap)
  const sqlPreview = sql.length > 150 ? `${sql.slice(0, 150)}…` : sql
  const summary = [`${shown.length} ${shown.length === 1 ? 'row' : 'rows'}`]
  if (opts.truncated) summary.push('result capped')
  if (opts.durationMs !== undefined) summary.push(`${opts.durationMs} ms`)

  const lines = [
    `🔎 *Query result*  ${summary.join(' · ')}`,
    ...(shown.length === 0 ? ['_No rows returned._'] : shown.map(resultLine)),
  ]
  return [
    ...slackSections(lines),
    context(`\`${escapeSlackMrkdwn(sqlPreview)}\``),
  ]
}

function resultLine(row: Record<string, unknown>): string {
  const columns = Object.keys(row)
  const [lead, ...rest] = columns.slice(0, MAX_RESULT_COLUMNS)
  const parts = [
    `*${escapeSlackMrkdwn(formatCell(row[lead]))}*`,
    ...rest.map(
      (c) =>
        `${escapeSlackMrkdwn(formatCell(c))} ${escapeSlackMrkdwn(formatCell(row[c]))}`
    ),
  ]
  const hidden = columns.length - MAX_RESULT_COLUMNS
  if (hidden > 0) parts.push(`+${hidden} columns`)
  return parts.join(' · ')
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  // One row is one Slack line, so a multi-line cell (SQL text) is flattened.
  const s = (
    typeof value === 'object' ? JSON.stringify(value) : String(value)
  ).replace(/\s+/g, ' ')
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

/**
 * List recent firing alerts (from the D1 alert-history audit log). Recovery
 * rows are excluded by the caller; this renders whatever it is given.
 */
export function buildAlertListBlocks(events: AlertEventRecord[]): SlackBlock[] {
  if (events.length === 0) {
    return [
      header('🔔 Recent alerts'),
      section('_No recent alerts._ Alert history requires `CHM_CLOUD_D1`.'),
    ]
  }

  const blocks: SlackBlock[] = [header('🔔 Recent alerts')]
  for (const e of events) {
    const emoji = SEVERITY_EMOJI[e.severity] ?? '⚪'
    const host = e.hostLabel || `host ${e.hostId}`
    blocks.push(
      section(
        `${emoji} *${e.rule}* — ${host}\n${e.value === null || e.value === undefined ? '' : `value ${e.value} · `}${e.eventTime}`
      )
    )
  }
  return blocks
}

/**
 * Build an alert message that carries an "Acknowledge" button, laid out like
 * the app's thread details ({@link slackAlertBlocks}): the `action_id` is
 * {@link ACK_ACTION_ID} and the button `value` encodes the alert's dedup key
 * so the interactions route can write the ACK + edit this message.
 */
export function buildAlertBlocksWithAck(
  payload: AlertPayload,
  ackKey: AckKey
): SlackBlock[] {
  // Recovery messages don't need an ACK button — nothing to acknowledge.
  const ack: SlackBlock[] =
    payload.severity === 'recovery'
      ? []
      : [
          {
            type: 'actions',
            block_id: 'chmonitor_ack',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
                style: 'primary',
                action_id: ACK_ACTION_ID,
                value: encodeAckValue(ackKey),
              },
            ],
          },
        ]
  return slackAlertBlocks(payload, ack)
}

/**
 * The same alert message after it has been acknowledged: the ACK button is
 * replaced by a context line naming who acked it and when. Used by the
 * interactions route's `chat.update` / response_url replacement.
 */
export function buildAckedMessageBlocks(
  original: SlackBlock[],
  ackedBy: string,
  ackedAtIso: string
): SlackBlock[] {
  const withoutActions = original.filter((b) => b.type !== 'actions')
  return [
    ...withoutActions,
    context(`✅ Acknowledged by <@${ackedBy}> · ${ackedAtIso}`),
  ]
}

/** A single host's compact line on the Home tab. */
export interface HomeHostSummary {
  hostId: number
  label: string
  memoryUsagePct: number | null
  diskUsagePct: number | null
  firing: number
}

/**
 * Publish-ready Home tab view: a per-host health summary plus a hint on how to
 * use the slash commands. `dashboardUrl`, when provided, becomes a link button.
 */
export function buildHomeTabView(
  hosts: HomeHostSummary[],
  opts: { dashboardUrl?: string } = {}
): SlackHomeView {
  const blocks: SlackBlock[] = [header('chmonitor')]

  if (hosts.length === 0) {
    blocks.push(section('_No ClickHouse hosts configured._'))
  } else {
    for (const h of hosts) {
      const flame = h.firing > 0 ? `🔴 ${h.firing} firing` : '🟢 healthy'
      blocks.push(
        section(
          `*${h.label}*  ${flame}\nMemory ${pct(h.memoryUsagePct)} · Disk ${pct(h.diskUsagePct)}`
        )
      )
    }
  }

  blocks.push(divider)
  blocks.push(
    section(
      'Use `/chmonitor status`, `/chmonitor query <SQL>`, or `/chmonitor alert` in any channel.'
    )
  )

  if (opts.dashboardUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open dashboard', emoji: true },
          action_id: 'chmonitor_open_dashboard',
          url: opts.dashboardUrl,
        },
      ],
    })
  }

  return { type: 'home', blocks }
}
