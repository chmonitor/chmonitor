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

// ---------------------------------------------------------------------------
// Block Kit types (only the subset this app emits).
// ---------------------------------------------------------------------------

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
  fields?: SlackTextObject[]
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

// ---------------------------------------------------------------------------
// ACK button value codec.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared small helpers.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// /chmonitor status
// ---------------------------------------------------------------------------

/**
 * Cluster status summary blocks from an incident snapshot (running queries,
 * merges, memory/disk pressure, replication lag). Individual fields may be
 * null when their query failed — rendered as "n/a" rather than omitted.
 */
export function buildStatusBlocks(
  hostLabel: string,
  snapshot: IncidentSnapshot
): SlackBlock[] {
  const merges = snapshot.merges
  const fields: SlackTextObject[] = [
    { type: 'mrkdwn', text: `*Memory:*\n${pct(snapshot.memoryUsagePct)}` },
    { type: 'mrkdwn', text: `*Disk:*\n${pct(snapshot.diskUsagePct)}` },
    {
      type: 'mrkdwn',
      text: `*Running queries:*\n${snapshot.topQueries?.length ?? 'n/a'}`,
    },
    {
      type: 'mrkdwn',
      text: `*Active merges:*\n${merges ? `${merges.active}${merges.stuck > 0 ? ` (${merges.stuck} stuck)` : ''}` : 'n/a'}`,
    },
    {
      type: 'mrkdwn',
      text: `*Replication lag:*\n${snapshot.replicationLagSeconds === null ? 'n/a' : `${snapshot.replicationLagSeconds}s`}`,
    },
  ]

  return [
    header(`📊 Cluster status — ${hostLabel}`),
    { type: 'section', fields },
    context(`Captured ${snapshot.capturedAt}`),
  ]
}

// ---------------------------------------------------------------------------
// /chmonitor query
// ---------------------------------------------------------------------------

/**
 * Render a capped result set as a fenced code block (a real Block Kit table
 * type does not exist; a monospace preview is the idiomatic representation).
 * The caller enforces the row/time caps at query time; `rowCap` here only
 * controls how many are shown and whether a "+N more" note is appended.
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
  const blocks: SlackBlock[] = [
    header('🔎 Query result'),
    context(`\`${sqlPreview}\``),
  ]

  if (shown.length === 0) {
    blocks.push(section('_No rows returned._'))
  } else {
    const columns = Object.keys(shown[0])
    const lines = shown.map((row) =>
      columns.map((c) => formatCell(row[c])).join(' | ')
    )
    const table = [columns.join(' | '), ...lines].join('\n')
    // Guard against Slack's 3000-char section text limit.
    const body = table.length > 2800 ? `${table.slice(0, 2800)}\n…` : table
    const fence = '```'
    blocks.push(section(`${fence}${body}${fence}`))
  }

  const noteParts: string[] = [`${shown.length} row(s)`]
  if (opts.truncated) noteParts.push('result capped')
  if (opts.durationMs !== undefined) noteParts.push(`${opts.durationMs}ms`)
  blocks.push(context(noteParts.join(' · ')))
  return blocks
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

// ---------------------------------------------------------------------------
// /chmonitor alert
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Alert message with an ACK button (the outbound "alert bridge").
// ---------------------------------------------------------------------------

/**
 * Build a rich alert message that carries an "Acknowledge" button. This is the
 * ACK-enabled variant of lib/health/adapters/slack.ts's `buildSlackBody`: the
 * `action_id` is {@link ACK_ACTION_ID} and the button `value` encodes the
 * alert's dedup key so the interactions route can write the ACK + edit this
 * message.
 */
export function buildAlertBlocksWithAck(
  payload: AlertPayload,
  ackKey: AckKey
): SlackBlock[] {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? '⚪'
  const heading =
    payload.severity === 'recovery'
      ? 'RECOVERY'
      : payload.severity.toUpperCase()

  const blocks: SlackBlock[] = [
    header(`${emoji} ${heading}: ${payload.title}`),
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
        { type: 'mrkdwn', text: `*Detail:*\n${payload.label}` },
      ],
    },
  ]

  // Recovery messages don't need an ACK button — nothing to acknowledge.
  if (payload.severity !== 'recovery') {
    blocks.push({
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
    })
  }

  blocks.push(context(payload.timestamp))
  return blocks
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

// ---------------------------------------------------------------------------
// Home tab
// ---------------------------------------------------------------------------

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
