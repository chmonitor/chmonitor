/**
 * Twilio SMS dispatch (#2668), extracted verbatim in #2938.
 */

import type { ServerTwilioConfig } from './../../../server-alert-config'
import type { Severity } from './../../suppression'
import type { FindingContext } from './../finding-context'

import { dispatchTwilio } from './../../../twilio-dispatch'
import { SEVERITY_ORDER } from './../../suppression'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'

/**
 * Twilio SMS: a single global env-configured destination (no per-route
 * resolution yet, unlike webhook/PagerDuty/Telegram/ntfy targets) — mirrors
 * Opsgenie/email. SMS costs real money per message, so unlike every other
 * channel it also honours its OWN severity floor (`twilioConfig.minSeverity`,
 * default `'critical'`) on top of the global `HEALTH_ALERT_MIN_SEVERITY` gate
 * already applied to `effective` — a warning that clears the global gate still
 * will not page a phone unless overridden via
 * `HEALTH_ALERT_TWILIO_MIN_SEVERITY=warning`. A recovery is gated on the
 * severity it recovered FROM (`decision.previousSeverity`), so a condition that
 * never paged a phone as a warning does not page one when it clears either.
 * `dispatchTwilio` never throws (fails open), matching every other channel.
 *
 * Returns its own eligibility too — the caller counts an eligible Twilio send
 * as one immediate delivery target.
 */
export async function dispatchTwilioChannel(
  finding: FindingContext,
  twilioConfig: ServerTwilioConfig | null
): Promise<{ eligible: boolean; delivered: boolean }> {
  const { effective, isRecovery, decision } = finding

  const twilioTriggerSeverity: Severity = isRecovery
    ? decision.previousSeverity
    : effective
  const twilioEligible =
    twilioConfig !== null &&
    twilioTriggerSeverity !== 'ok' &&
    SEVERITY_ORDER[twilioTriggerSeverity] >=
      SEVERITY_ORDER[twilioConfig.minSeverity]
  if (!(twilioConfig && twilioEligible)) {
    return { eligible: twilioEligible, delivered: false }
  }

  const ok = await dispatchTwilio(buildChannelPayload(finding), twilioConfig)

  await recordChannelEvent(finding, {
    delivered: ok,
    error: ok ? undefined : 'Twilio dispatch failed',
    channel: 'twilio',
  })

  return { eligible: twilioEligible, delivered: ok }
}
