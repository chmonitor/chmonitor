/**
 * The audit trail of the dispatch pipeline (#2938): the pure decision→record
 * mapping plus the best-effort "record what this channel just did" wrapper
 * every channel calls after it sends.
 */

import type { AlertEventRecord } from './../../alert-history-store'
import type { AlertDecision } from './../../alert-state-store'
import type { FindingContext } from './finding-context'

import { recordAlertEvent } from './../../alert-history-store'
import { debug } from '@chm/logger'

/**
 * Map a notify decision + dispatch outcome into the shape the alert-history
 * store persists. Pure — no I/O — so the decision→record translation (the
 * trickiest part: `recovery` carries its own severity distinct from the
 * underlying `AlertRuleSeverity`, and a fresh `new` alert has no meaningful
 * previous severity) is unit-testable without mocking D1 or the sweep.
 */
export function buildAlertEventRecord(params: {
  hostId: number
  hostLabel: string
  ruleId: string
  decision: AlertDecision
  value: number | null
  delivered: boolean
  error?: string
  channel: string
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number
}): AlertEventRecord {
  const { decision } = params
  // Recovery is its own severity for audit purposes — the decision's
  // `severity` field is 'ok' (the condition classifies healthy again), which
  // isn't a useful thing to show in a log of *alert* events.
  const severity: AlertEventRecord['severity'] =
    decision.kind === 'recovery'
      ? 'recovery'
      : (decision.severity as 'warning' | 'critical')
  // 'ok' means "no prior firing condition" (e.g. a brand-new alert) — no
  // previous severity worth recording.
  const prevSeverity: AlertEventRecord['prevSeverity'] =
    decision.previousSeverity === 'ok' ? null : decision.previousSeverity

  return {
    eventTime: new Date(params.now ?? Date.now()).toISOString(),
    hostId: params.hostId,
    hostLabel: params.hostLabel,
    rule: params.ruleId,
    severity,
    prevSeverity,
    decisionKind: decision.kind,
    delivered: params.delivered,
    error: params.error ?? null,
    value: params.value,
    channel: params.channel,
  }
}

/**
 * Best-effort audit trail per channel — recorded on both success and failure
 * so a slow or failing D1 write can never delay or drop the alert that was
 * just dispatched. `recordAlertEvent` already never throws; the try/catch here
 * is defense-in-depth. Shared by every `dispatch*Channel`, which previously
 * repeated this block verbatim.
 */
export async function recordChannelEvent(
  finding: FindingContext,
  params: { delivered: boolean; error?: string; channel: string }
): Promise<void> {
  try {
    await recordAlertEvent(
      buildAlertEventRecord({
        hostId: finding.hostId,
        hostLabel: finding.hostLabel,
        ruleId: finding.ruleId,
        decision: finding.decision,
        value: finding.value,
        delivered: params.delivered,
        error: params.error,
        channel: params.channel,
      })
    )
  } catch (err) {
    debug(
      `[health-sweep] alert-history record failed for host ${finding.hostId} rule ${finding.ruleId}`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
