/**
 * The per-finding facts every channel needs (#2938).
 *
 * {@link FindingContext} is assembled once by the orchestrator after the dedup
 * decision + suppression gates have run, then handed to each
 * `dispatch*Channel`. It carries no channel config and no delivery state — a
 * channel reads it, sends, and reports back whether it delivered.
 */

import type { AlertPayload } from './../../adapters'
import type { AlertSeverity } from './../../adapters/types'
import type { AlertDecision } from './../../alert-state-store'
import type { Severity } from './../suppression'

export interface FindingContext {
  hostId: number
  /** Display name of the host (`hostName` on the incoming params). */
  hostLabel: string
  ruleId: string
  ruleTitle: string
  label: string
  value: number | null
  /** Thresholds that classified this finding, when known (base rules only). */
  warnThreshold?: number | null
  critThreshold?: number | null
  /** Finding severity after the global min-severity floor. */
  effective: Severity
  isRecovery: boolean
  decision: AlertDecision
  /** The one-line message shared by the webhook/Slack bodies. */
  text: string
}

/**
 * The severity a channel payload carries: a recovery is its own severity, an
 * alert reports the (already floored) `effective` one.
 */
export function channelAlertSeverity(finding: FindingContext): AlertSeverity {
  return finding.isRecovery
    ? 'recovery'
    : (finding.effective as 'warning' | 'critical')
}

/**
 * The normalized payload every single-destination channel builds (Opsgenie,
 * email, Telegram, ntfy, Twilio, Pushover). Each call stamps its own
 * `timestamp` — deliberately, so a channel's payload records when THAT channel
 * dispatched, exactly as the inline per-channel literals did.
 */
export function buildChannelPayload(finding: FindingContext): AlertPayload {
  return {
    severity: channelAlertSeverity(finding),
    hostLabel: finding.hostLabel,
    hostId: finding.hostId,
    metric: finding.ruleId,
    value: finding.value,
    warnThreshold: finding.warnThreshold,
    critThreshold: finding.critThreshold,
    title: finding.ruleTitle,
    label: finding.label,
    timestamp: new Date().toISOString(),
  }
}
