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

/** Notification heading for a single severity (recovery reads as "RECOVERY"). */
function findingHeading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
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
export function digestFindingLine(payload: AlertPayload): string {
  const firedFor = firedForLine(payload)
  const detail =
    payload.stillOpenMs !== undefined
      ? stillOpenLine(payload)
      : firedFor
        ? `${payload.label}, ${firedFor}`
        : payload.label
  return `[${findingHeading(payload.severity)}] ${payload.title} — ${detail} (host ${payload.hostLabel})`
}

export interface DigestSummary {
  /** Human summary, e.g. `"3 critical, 2 warning on 4 hosts"` (prefixed `[instance] ` when set). */
  summaryLine: string
  /** One line per finding (severity-prefixed), already capped to {@link MAX_DIGEST_LINES}. */
  findingLines: string[]
  /** Findings beyond the cap (0 when nothing was truncated). */
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
  const countText =
    parts.length > 0 ? parts.join(', ') : `${payloads.length} alerts`
  // One digest is one deployment's findings, so the first payload's instance
  // labels the whole group ('' when unset).
  const summaryLine = `${instancePrefix(payloads[0] ?? {})}${countText} on ${hostCount} ${hostWord}`

  const findingLines = payloads
    .slice(0, MAX_DIGEST_LINES)
    .map(digestFindingLine)
  const overflow = Math.max(0, payloads.length - MAX_DIGEST_LINES)

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
