/**
 * Digest (multi-finding) summarization — pure, channel-agnostic (feat #2663).
 *
 * When one sweep pass produces several dispatchable findings for the SAME
 * delivery target (e.g. a disk filling on 8 hosts all routed to one Slack
 * channel), the sweep sends ONE combined message instead of N. This module
 * turns a list of {@link AlertPayload}s into the shared pieces every
 * digest-capable adapter renders: a summary line ("3 critical, 2 warning on 4
 * hosts") and one line per finding. Each adapter (Slack blocks, generic JSON,
 * Telegram MarkdownV2) wraps these in its own body shape.
 *
 * PURE — no network, no clock — so the summary is trivially unit-testable and
 * identical across channels.
 */

import type { AlertPayload, AlertSeverity } from './types'

import { instancePrefix } from './identity'

/** Cap on rendered per-finding lines so a huge burst can't blow a channel's
 * message-size limit (Slack ~3000 chars/section, Telegram 4096). Overflow is
 * summarized with a "…and N more" line. Generic JSON is exempt (structured). */
export const MAX_DIGEST_LINES = 25

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  recovery: 0,
  warning: 1,
  critical: 2,
}

/** Notification heading for a single severity (recovery reads as "RESOLVED"). */
function findingHeading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RESOLVED' : severity.toUpperCase()
}

/** `"3 h"`; minutes under an hour. */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

/** `"still open, 3 h"` for a reminder; minutes under an hour. */
export function stillOpenText(ms: number): string {
  return `still open, ${spanText(ms)}`
}

/** `"fired for 3 h"` for a recovery whose incident length is known, else ''. */
export function firedForLine(
  payload: Pick<AlertPayload, 'severity' | 'firedForMs'>
): string {
  return payload.severity === 'recovery' && payload.firedForMs !== undefined
    ? `fired for ${spanText(payload.firedForMs)}`
    : ''
}

/**
 * The incident timeline fact every channel shows: `still open, 3 h (82.8 ->
 * 82.9)` on a reminder, `fired for 3 h` on a recovery, '' otherwise.
 */
export function incidentLine(
  payload: Pick<
    AlertPayload,
    'severity' | 'stillOpenMs' | 'previousValue' | 'value' | 'firedForMs'
  >
): string {
  return payload.stillOpenMs !== undefined
    ? stillOpenLine(payload)
    : firedForLine(payload)
}

/**
 * `"still open, 3 h (82.8 -> 82.9)"` for a reminder payload. The arrow is
 * left out unless both the previous and the current value are numbers.
 */
export function stillOpenLine(
  payload: Pick<AlertPayload, 'stillOpenMs' | 'previousValue' | 'value'>
): string {
  const open = stillOpenText(payload.stillOpenMs ?? 0)
  const { previousValue, value } = payload
  return typeof previousValue === 'number' &&
    Number.isFinite(previousValue) &&
    typeof value === 'number' &&
    Number.isFinite(value)
    ? `${open} (${previousValue} -> ${value})`
    : open
}

/**
 * One finding's one-line description, mirroring the single-alert `text`. A
 * reminder (`stillOpenMs` set) replaces the label with how long it is open.
 */
export function digestFindingLine(
  payload: AlertPayload,
  options: { withHost?: boolean } = {}
): string {
  const firedFor = firedForLine(payload)
  const detail =
    payload.stillOpenMs !== undefined
      ? stillOpenLine(payload)
      : firedFor
        ? `${payload.label}, ${firedFor}`
        : payload.label
  const host = options.withHost === false ? '' : ` (host ${payload.hostLabel})`
  return `[${findingHeading(payload.severity)}] ${payload.title} — ${detail}${host}`
}

/**
 * True when several findings share one host, so a per-row host is the same on
 * every row and the header names it instead (#4246). A lone finding keeps its
 * host: it has no other rows to repeat.
 */
export function sharesOneHost(payloads: readonly AlertPayload[]): boolean {
  return (
    payloads.length > 1 && new Set(payloads.map((p) => p.hostId)).size === 1
  )
}

/** Example names shown on a grouped digest row before the `+N` remainder. */
export const DIGEST_GROUP_EXAMPLES = 3

/** Findings of one rule at one severity (recovery is its own group) (#4246). */
export interface DigestGroup {
  metric: string
  severity: AlertSeverity
  title: string
  payloads: AlertPayload[]
}

/**
 * Group findings by (rule, severity) in first-seen order, so 34 findings of one
 * rule become one digest row instead of 34.
 */
export function groupDigest(payloads: readonly AlertPayload[]): DigestGroup[] {
  const groups = new Map<string, DigestGroup>()
  for (const p of payloads) {
    const key = `${p.metric}\u0000${p.severity}`
    const group = groups.get(key)
    if (group) group.payloads.push(p)
    else
      groups.set(key, {
        metric: p.metric,
        severity: p.severity,
        title: p.title,
        payloads: [p],
      })
  }
  return [...groups.values()]
}

/**
 * `"source-1, source-2, source-3, +31"`: the names that tell a group's findings
 * apart. Hosts when the group spans several hosts, otherwise each finding's label.
 */
export function digestGroupExamples(group: DigestGroup): string {
  const hosts = new Set(group.payloads.map((p) => p.hostLabel))
  const names = [
    ...new Set(
      group.payloads.map((p) => (hosts.size > 1 ? p.hostLabel : p.label))
    ),
  ].slice(0, DIGEST_GROUP_EXAMPLES)
  const rest = group.payloads.length - names.length
  return rest > 0 ? [...names, `+${rest}`].join(', ') : names.join(', ')
}

/**
 * One digest row for a group. A group of one renders as
 * {@link digestFindingLine}; a larger group uses the rule title, a count and a
 * few example names, so truncation never hides the cause.
 */
export function digestGroupLine(
  group: DigestGroup,
  options: { withHost?: boolean } = {}
): string {
  const [first] = group.payloads
  if (group.payloads.length === 1) return digestFindingLine(first, options)
  return `[${findingHeading(group.severity)}] ${group.title} · ${group.payloads.length} (${digestGroupExamples(group)})`
}

export interface DigestSummary {
  /** Human summary, e.g. `"3 critical, 2 warning on 4 hosts"` (prefixed `[instance] ` when set). */
  summaryLine: string
  /** One line per (rule, severity) group (severity-prefixed), capped to {@link MAX_DIGEST_LINES}. */
  findingLines: string[]
  /** Findings in the groups beyond the cap (0 when nothing was truncated). */
  overflow: number
  /** Highest severity present — drives the digest's colour/emoji. */
  topSeverity: AlertSeverity
  counts: { critical: number; warning: number; recovery: number }
  /** Distinct hosts across the findings. */
  hostCount: number
  /** Total findings (before the line cap). */
  total: number
}

/**
 * Summarize a group of findings bound for the same target.
 *
 * The summary line lists non-zero severity counts in descending severity
 * (critical, warning, recovery) followed by the distinct host count.
 */
export function summarizeDigest(
  payloads: readonly AlertPayload[]
): DigestSummary {
  const counts = { critical: 0, warning: 0, recovery: 0 }
  const hosts = new Set<number>()
  let topSeverity: AlertSeverity = 'recovery'

  for (const p of payloads) {
    counts[p.severity]++
    hosts.add(p.hostId)
    if (SEVERITY_RANK[p.severity] > SEVERITY_RANK[topSeverity]) {
      topSeverity = p.severity
    }
  }

  const parts: string[] = []
  if (counts.critical > 0) parts.push(`${counts.critical} critical`)
  if (counts.warning > 0) parts.push(`${counts.warning} warning`)
  if (counts.recovery > 0) parts.push(`${counts.recovery} recovery`)

  const hostCount = hosts.size
  const hostWord = hostCount === 1 ? 'host' : 'hosts'
  const hostName = sharesOneHost(payloads) ? ` (${payloads[0].hostLabel})` : ''
  const countText =
    parts.length > 0 ? parts.join(', ') : `${payloads.length} alerts`
  // One digest is one deployment's findings, so the first payload's instance
  // labels the whole group ('' when unset).
  const summaryLine = `${instancePrefix(payloads[0] ?? {})}${countText} on ${hostCount} ${hostWord}${hostName}`

  const groups = groupDigest(payloads)
  const withHost = !sharesOneHost(payloads)
  const findingLines = groups
    .slice(0, MAX_DIGEST_LINES)
    .map((g) => digestGroupLine(g, { withHost }))
  const overflow = groups
    .slice(MAX_DIGEST_LINES)
    .reduce((n, g) => n + g.payloads.length, 0)

  return {
    summaryLine,
    findingLines,
    overflow,
    topSeverity,
    counts,
    hostCount,
    total: payloads.length,
  }
}

/** What a sweep changed in the open set, for a one-line update (#4246). */
export interface DigestDelta {
  added: { critical: number; warning: number }
  resolved: number
  /** Open findings after this sweep. */
  open: number
}

/**
 * `"+1 warning · 1 resolved · 60 open"`: the short update sent instead of a
 * full digest when a sweep only adds findings of an already-open rule or only
 * resolves. Parts with a zero count are left out; `open` always shows.
 */
export function digestDeltaLine(
  delta: DigestDelta,
  payload: Partial<AlertPayload> = {}
): string {
  const parts: string[] = []
  if (delta.added.critical > 0) parts.push(`+${delta.added.critical} critical`)
  if (delta.added.warning > 0) parts.push(`+${delta.added.warning} warning`)
  if (delta.resolved > 0) parts.push(`${delta.resolved} resolved`)
  parts.push(`${delta.open} open`)
  return `${instancePrefix(payload)}${parts.join(' · ')}`
}

/** Count a delta from the payloads of one update (recovery = resolved). */
export function digestDeltaOf(
  payloads: readonly AlertPayload[],
  open: number
): DigestDelta {
  const delta: DigestDelta = {
    added: { critical: 0, warning: 0 },
    resolved: 0,
    open,
  }
  for (const p of payloads) {
    if (p.severity === 'recovery') delta.resolved++
    else delta.added[p.severity]++
  }
  return delta
}
