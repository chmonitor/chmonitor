/**
 * PeerDB issue alerting — classify / format / validate / audit / investigate.
 *
 * Lifecycle (see issue #3405):
 *
 *   collect (read-only PeerDB signals, caller-provided)
 *     → classify (ok / warning / error)
 *     → format (human-readable title + text + label)
 *     → validate (message well-formedness)
 *     → audit (best-effort `alert_events` row, never throws)
 *     → investigate (agent-workflow pre-send step: metrics + message check)
 *     → delivery gate (dry-run / idempotency / verdict)
 *
 * Everything here is PURE except `auditPeerDBAlert`, which is best-effort and
 * never throws — mirroring `alert-history-store.recordAlertEvent`. No PeerDB
 * mutation API is assumed: this module never calls pause/resume/restart, it
 * only reasons about caller-supplied read-only snapshots.
 */

import type { AlertPayload } from '@/lib/health/adapters/types'

export type PeerDBAlertSeverity = 'ok' | 'warning' | 'error'

/**
 * Where the error count came from. The mirror-logs endpoint is known to
 * return `0` in cases where the count is actually unavailable (separate
 * error-count-zero bug) — so a zero MUST be labeled with its provenance and
 * never silently treated as "no errors". That root-cause fix lives elsewhere;
 * this contract just makes the ambiguity explicit at the boundary.
 */
export type PeerDBErrorCountSource = 'log-api' | 'unavailable'

export interface PeerDBMirrorSignal {
  /** Mirror / flow name, e.g. `pg_to_ch`. */
  flowName: string
  /** Raw `currentFlowState` string (`STATUS_FAILED`, `STATUS_RUNNING`, …). */
  status?: string | null
  /** Latest `errorMessage` from `POST /v1/mirrors/status`, if any. */
  errorMessage?: string | null
  /** CDC lag in seconds (`lagSec`), if reported. */
  lagSec?: number | null
  /** Rows-synced total, if reported (used for stall detection context). */
  rowsSynced?: number | null
  /** Recent error/log entries for this flow. */
  recentErrorCount?: number
  /** Provenance of `recentErrorCount` — see `PeerDBErrorCountSource`. */
  errorCountSource?: PeerDBErrorCountSource
  /** Replication slot lag in MB, if reported. */
  slotLagMb?: number | null
  /** Whether the snapshot/initial-load phase looks stalled (caller-detected). */
  snapshotStalled?: boolean
}

export interface PeerDBAlertThresholds {
  /** CDC lag seconds at/above which the mirror is `warning`. Default 300. */
  lagWarnSec: number
  /** CDC lag seconds at/above which the mirror is `error`. Default 1800. */
  lagErrorSec: number
  /** Slot lag MB at/above which the mirror is `warning`. Default 512. */
  slotLagWarnMb: number
  /** Slot lag MB at/above which the mirror is `error`. Default 2048. */
  slotLagErrorMb: number
  /** Recent error count at/above which the mirror is `warning`. Default 1. */
  errorWarnCount: number
  /** Recent error count at/above which the mirror is `error`. Default 5. */
  errorErrorCount: number
}

export const DEFAULT_PEERDB_ALERT_THRESHOLDS: PeerDBAlertThresholds = {
  lagWarnSec: 300,
  lagErrorSec: 1800,
  slotLagWarnMb: 512,
  slotLagErrorMb: 2048,
  errorWarnCount: 1,
  errorErrorCount: 5,
}

/** Statuses that always classify `error`, regardless of numeric signals. */
const ERROR_STATUSES = new Set(['STATUS_FAILED', 'STATUS_TERMINATED'])

const WARN_STATUSES = new Set([
  'STATUS_PAUSING',
  'STATUS_PAUSED',
  'STATUS_TERMINATING',
  'STATUS_UNKNOWN',
])

export interface PeerDBClassification {
  severity: PeerDBAlertSeverity
  /** Machine-readable reason codes, most severe first. */
  reasons: string[]
}

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Classify one mirror's read-only signals into ok / warning / error.
 *
 * Pure, no side effects. Precedence: failed/terminated status > numeric error
 * signals > warn statuses / warn thresholds > ok. An `unavailable` error count
 * never classifies on its own — it is reported as a reason so the formatted
 * message can say "error count unavailable" instead of "0 errors".
 */
export function classifyPeerDBMirror(
  signal: PeerDBMirrorSignal,
  thresholds: PeerDBAlertThresholds = DEFAULT_PEERDB_ALERT_THRESHOLDS
): PeerDBClassification {
  const reasons: string[] = []
  let severity: PeerDBAlertSeverity = 'ok'

  const escalate = (next: PeerDBAlertSeverity, reason: string) => {
    reasons.push(reason)
    if (next === 'error') severity = 'error'
    else if (next === 'warning' && severity === 'ok') severity = 'warning'
  }

  const status = signal.status?.trim() ?? ''
  if (ERROR_STATUSES.has(status)) {
    escalate('error', `status:${status}`)
  }

  if (signal.errorMessage?.trim()) {
    escalate('error', 'error-message-present')
  }

  const lag = finiteOrNull(signal.lagSec)
  if (lag !== null && lag >= thresholds.lagErrorSec) {
    escalate('error', 'cdc-lag-error')
  }

  const slotLag = finiteOrNull(signal.slotLagMb)
  if (slotLag !== null && slotLag >= thresholds.slotLagErrorMb) {
    escalate('error', 'slot-lag-error')
  }

  const source = signal.errorCountSource ?? 'log-api'
  const count =
    typeof signal.recentErrorCount === 'number' &&
    Number.isFinite(signal.recentErrorCount)
      ? signal.recentErrorCount
      : null
  if (source === 'unavailable' || count === null) {
    // Ambiguous zero — surfaced for the message, never classified on.
    reasons.push('error-count-unavailable')
  } else if (count >= thresholds.errorErrorCount) {
    escalate('error', 'error-count-error')
  } else if (count >= thresholds.errorWarnCount) {
    escalate('warning', 'error-count-warning')
  }

  if (lag !== null && lag >= thresholds.lagWarnSec && severity === 'ok') {
    escalate('warning', 'cdc-lag-warning')
  }
  if (
    slotLag !== null &&
    slotLag >= thresholds.slotLagWarnMb &&
    severity === 'ok'
  ) {
    escalate('warning', 'slot-lag-warning')
  }
  if (signal.snapshotStalled) {
    escalate('warning', 'snapshot-stalled')
  }
  if (WARN_STATUSES.has(status) && severity === 'ok') {
    escalate('warning', `status:${status}`)
  }

  return { severity, reasons }
}

export interface PeerDBAlertMessage {
  title: string
  /** One-line human-readable summary, safe to embed in chat/webhook bodies. */
  text: string
  /** Short value label, e.g. `STATUS_FAILED · 3 recent errors · lag 45s`. */
  label: string
}

const MAX_ERROR_SNIPPET = 160

function sanitizeFlowName(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 120) : '(unnamed mirror)'
}

function sanitizeErrorSnippet(raw: string | null | undefined): string | null {
  if (!raw) return null
  const oneLine = raw.trim().replace(/\s+/g, ' ')
  if (!oneLine) return null
  return oneLine.length > MAX_ERROR_SNIPPET
    ? `${oneLine.slice(0, MAX_ERROR_SNIPPET)}…`
    : oneLine
}

function formatLag(lagSec: number | null): string | null {
  if (lagSec === null) return null
  if (lagSec < 60) return `lag ${Math.round(lagSec)}s`
  if (lagSec < 3600) return `lag ${(lagSec / 60).toFixed(1)}m`
  return `lag ${(lagSec / 3600).toFixed(1)}h`
}

/**
 * Format a human-readable alert message for a classified mirror.
 *
 * Pure. Never includes secrets — only the flow name, status, truncated
 * one-line error snippet, and numeric signals. Long inputs are truncated.
 */
export function formatPeerDBAlertMessage(
  signal: PeerDBMirrorSignal,
  classification: PeerDBClassification
): PeerDBAlertMessage {
  const flow = sanitizeFlowName(signal.flowName)
  const severity = classification.severity.toUpperCase()
  const status = signal.status?.trim() || 'status unknown'
  const lag = formatLag(finiteOrNull(signal.lagSec))
  const snippet = sanitizeErrorSnippet(signal.errorMessage)

  const labelParts: string[] = [status]
  const source = signal.errorCountSource ?? 'log-api'
  if (source === 'unavailable') {
    labelParts.push('error count unavailable')
  } else if (
    typeof signal.recentErrorCount === 'number' &&
    Number.isFinite(signal.recentErrorCount) &&
    signal.recentErrorCount > 0
  ) {
    const n = Math.floor(signal.recentErrorCount)
    labelParts.push(`${n} recent error${n === 1 ? '' : 's'}`)
  }
  if (lag) labelParts.push(lag)
  const slotLag = finiteOrNull(signal.slotLagMb)
  if (slotLag !== null) labelParts.push(`slot ${Math.round(slotLag)}MB`)
  if (signal.snapshotStalled) labelParts.push('snapshot stalled')
  const label = labelParts.join(' · ')

  const title = `[${severity}] PeerDB mirror ${flow}`
  const text = snippet
    ? `[${severity}] PeerDB mirror ${flow} — ${label}: ${snippet}`
    : `[${severity}] PeerDB mirror ${flow} — ${label}`

  return { title, text, label }
}

export interface PeerDBMessageValidation {
  ok: boolean
  issues: string[]
}

const MAX_MESSAGE_TEXT = 2000
const MAX_MESSAGE_TITLE = 200

/**
 * Validate a formatted message before audit/investigation/delivery.
 *
 * Pure. Catches empty flow names, missing severity prefixes, over-long
 * bodies, and accidental secret leakage (`password`/`token`/`secret`/
 * `authorization` substrings) so a mis-formatted message is held, not sent.
 */
export function validatePeerDBAlertMessage(
  message: PeerDBAlertMessage
): PeerDBMessageValidation {
  const issues: string[] = []
  if (!message.title.trim()) issues.push('title-empty')
  if (!message.text.trim()) issues.push('text-empty')
  if (!message.label.trim()) issues.push('label-empty')
  if (message.title.length > MAX_MESSAGE_TITLE) issues.push('title-too-long')
  if (message.text.length > MAX_MESSAGE_TEXT) issues.push('text-too-long')
  if (!/^\[(OK|WARNING|ERROR)\]/.test(message.title.trim())) {
    issues.push('title-missing-severity-prefix')
  }
  const leak =
    /(password|passwd|secret|api[_-]?token|authorization|bearer\s+[a-z0-9])/i
  if (leak.test(message.text) || leak.test(message.title)) {
    issues.push('possible-secret-leak')
  }
  return { ok: issues.length === 0, issues }
}

/**
 * Map a classified + formatted mirror alert onto the shared channel-agnostic
 * `AlertPayload` so existing notification adapters (Slack/Discord/PagerDuty/
 * generic JSON) can render it without PeerDB-specific code. `error` maps to
 * `critical`; `ok` maps to `warning`-floor callers simply skip (documented on
 * the delivery gate — `ok` findings never notify).
 */
export function buildPeerDBAlertPayload(params: {
  signal: PeerDBMirrorSignal
  classification: PeerDBClassification
  message: PeerDBAlertMessage
  hostId?: number
  timestamp?: string
}): AlertPayload {
  return {
    severity:
      params.classification.severity === 'error' ? 'critical' : 'warning',
    hostLabel: `peerdb:${sanitizeFlowName(params.signal.flowName)}`,
    hostId: params.hostId ?? 0,
    metric: 'peerdb-mirror-health',
    value: finiteOrNull(params.signal.lagSec),
    warnThreshold: DEFAULT_PEERDB_ALERT_THRESHOLDS.lagWarnSec,
    critThreshold: DEFAULT_PEERDB_ALERT_THRESHOLDS.lagErrorSec,
    title: params.message.title,
    label: params.message.label,
    timestamp: params.timestamp ?? new Date().toISOString(),
  }
}

/**
 * Best-effort audit record for a PeerDB alert decision. Appends to the same
 * `alert_events` audit log the health sweep uses (`decisionKind:
 * 'peerdb-issue'`), so PeerDB alerts show up in alert history. NEVER throws —
 * a missing D1 binding or write failure resolves silently, exactly like
 * `recordAlertEvent` itself.
 */
export async function auditPeerDBAlert(params: {
  flowName: string
  severity: PeerDBAlertSeverity | 'recovery'
  decisionKind?: string
  delivered: boolean
  error?: string
  channel?: string
  value?: number | null
  hostId?: number
}): Promise<void> {
  try {
    const { recordAlertEvent } = await import(
      '@/lib/health/alert-history-store'
    )
    await recordAlertEvent({
      eventTime: new Date().toISOString(),
      hostId: params.hostId ?? 0,
      hostLabel: `peerdb:${sanitizeFlowName(params.flowName)}`,
      rule: 'peerdb-mirror-health',
      severity:
        params.severity === 'error'
          ? 'critical'
          : params.severity === 'warning'
            ? 'warning'
            : params.severity === 'recovery'
              ? 'recovery'
              : 'warning',
      prevSeverity: null,
      decisionKind: params.decisionKind ?? 'peerdb-issue',
      delivered: params.delivered,
      error: params.error ?? null,
      value: params.value ?? null,
      channel: params.channel ?? 'peerdb',
    })
  } catch {
    // Swallow: audit is observational and must never break the caller.
  }
}

// ---------------------------------------------------------------------------
// Agent investigation (pre-send step)
// ---------------------------------------------------------------------------

export interface PeerDBInvestigationMetrics {
  /** Mirror status rows collected read-only (status/log/lag/slot snapshots). */
  signalsCollected: number
  /** Whether a CDC-lag data point was available. */
  hasLagSample: boolean
  /** Whether a recent-errors sample was available (vs `unavailable`). */
  hasErrorSample: boolean
  /** Whether a slot-lag sample was available. */
  hasSlotSample: boolean
}

export interface PeerDBInvestigation {
  investigatedAt: string
  /** `send` = message may proceed to the delivery gate; `hold` = do not send. */
  verdict: 'send' | 'hold'
  checks: string[]
  notes: string[]
}

/**
 * Agent-workflow pre-send investigation for a PeerDB alert.
 *
 * Runs BEFORE any outbound delivery: re-checks that relevant read-only
 * metrics were actually collected, re-validates the formatted message, and
 * returns a `send`/`hold` verdict. Pure and side-effect-free — the caller
 * supplies the already-collected metrics snapshot (collected via read-only
 * `peerdbFetch` GETs), so this step never touches the network and never
 * assumes a PeerDB mutation API exists. A `hold` verdict MUST block delivery
 * (see `shouldDeliverPeerDBAlert`).
 */
export function investigatePeerDBAlert(params: {
  signal: PeerDBMirrorSignal
  classification: PeerDBClassification
  message: PeerDBAlertMessage
  metrics: PeerDBInvestigationMetrics
  validation?: PeerDBMessageValidation
  now?: number
}): PeerDBInvestigation {
  const checks: string[] = []
  const notes: string[] = []
  let hold = false

  const validation =
    params.validation ?? validatePeerDBAlertMessage(params.message)
  checks.push(
    validation.ok ? 'message-validation:pass' : 'message-validation:fail'
  )
  if (!validation.ok) {
    hold = true
    notes.push(`message issues: ${validation.issues.join(', ')}`)
  }

  if (params.classification.severity === 'ok') {
    checks.push('severity:ok-no-action')
    hold = true
    notes.push('classification is ok — nothing to send')
  } else {
    checks.push(`severity:${params.classification.severity}`)
  }

  if (params.metrics.signalsCollected < 1) {
    checks.push('metrics:missing')
    hold = true
    notes.push('no read-only signals collected — refusing to send blind')
  } else {
    checks.push(`metrics:signals=${params.metrics.signalsCollected}`)
  }
  if (!params.metrics.hasLagSample) {
    notes.push('no CDC-lag sample — message states lag only if observed')
  }
  if (!params.metrics.hasErrorSample) {
    notes.push('error count unavailable — message must say so, not "0 errors"')
  }

  const reasons = params.classification.reasons.join(',')
  checks.push(`reasons:${reasons || 'none'}`)

  return {
    investigatedAt: new Date(params.now ?? Date.now()).toISOString(),
    verdict: hold ? 'hold' : 'send',
    checks,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Delivery gate: dry-run + idempotency + verdict
// ---------------------------------------------------------------------------

/** One-hour dedup buckets, matching the sweep's incident-window convention. */
const DEDUP_WINDOW_MS = 60_000 * 60

/**
 * Stable idempotency key for a PeerDB alert: `peerdb:<flow>:<severity>:<hour
 * bucket>`. Repeated evaluations of the same condition within the hour dedup
 * downstream; pass a `seen` set (or a persistent store) to enforce it.
 */
export function peerDBDedupKey(params: {
  flowName: string
  severity: PeerDBAlertSeverity
  now?: number
}): string {
  const flow = sanitizeFlowName(params.flowName)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
  const bucket = Math.floor((params.now ?? Date.now()) / DEDUP_WINDOW_MS)
  return `peerdb:${flow}:${params.severity}:${bucket}`
}

export interface PeerDBDeliveryDecision {
  deliver: boolean
  reason: string
  dedupKey: string
}

/**
 * Final gate before ANY outbound delivery. Delivery requires ALL of:
 * `dryRun === false`, validation ok, investigation verdict `send`, severity
 * above `ok`, and a dedup key not already seen. Pure — the caller owns the
 * `seen` set (in-memory or persistent) and the actual transport.
 */
export function shouldDeliverPeerDBAlert(params: {
  severity: PeerDBAlertSeverity
  validation: PeerDBMessageValidation
  investigation: PeerDBInvestigation
  dedupKey: string
  seen: ReadonlySet<string>
  dryRun?: boolean
}): PeerDBDeliveryDecision {
  if (params.dryRun !== false) {
    return {
      deliver: false,
      reason: 'dry-run',
      dedupKey: params.dedupKey,
    }
  }
  if (params.severity === 'ok') {
    return { deliver: false, reason: 'severity-ok', dedupKey: params.dedupKey }
  }
  if (!params.validation.ok) {
    return {
      deliver: false,
      reason: `validation-failed:${params.validation.issues.join(',')}`,
      dedupKey: params.dedupKey,
    }
  }
  if (params.investigation.verdict !== 'send') {
    return {
      deliver: false,
      reason: 'investigation-hold',
      dedupKey: params.dedupKey,
    }
  }
  if (params.seen.has(params.dedupKey)) {
    return { deliver: false, reason: 'duplicate', dedupKey: params.dedupKey }
  }
  return { deliver: true, reason: 'send', dedupKey: params.dedupKey }
}
