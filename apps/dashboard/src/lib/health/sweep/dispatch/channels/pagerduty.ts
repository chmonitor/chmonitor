/**
 * PagerDuty Events API v2 fan-out (plan 34), extracted verbatim in #2938.
 */

import type { AlertPayload } from './../../../adapters'
import type { PagerDutyTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { buildPagerDutyBody } from './../../../adapters'
import { recordChannelEvent } from './../alert-event-record'
import { channelAlertSeverity } from './../finding-context'
import { postPagerDutyEvent } from './../webhook-post'

/**
 * Dispatch to every resolved PagerDuty service. Returns whether ANY of them
 * delivered.
 */
export async function dispatchPagerDutyChannel(
  finding: FindingContext,
  pagerDutyTargets: PagerDutyTarget[]
): Promise<boolean> {
  if (pagerDutyTargets.length === 0) return false

  const { hostId, hostLabel: name, ruleId, ruleTitle, value, label } = finding
  let anyDelivered = false

  // `decision.kind === 'recovery'` maps to `event_action: 'resolve'`
  // inside `buildPagerDutyBody`; the stable `chmonitor:{hostId}:{metric}`
  // dedup key is what lets PagerDuty collapse repeat triggers into one
  // open incident and auto-resolve it here. `metric` is the rule id, so
  // this key aligns 1:1 with the sweep's own `hostId:ruleId` dedup.
  const pagerDutyPayload: AlertPayload = {
    severity: channelAlertSeverity(finding),
    hostLabel: name,
    hostId,
    metric: ruleId,
    value,
    title: ruleTitle,
    label,
    timestamp: new Date().toISOString(),
  }

  for (const target of pagerDutyTargets) {
    const body = buildPagerDutyBody(pagerDutyPayload, {
      routingKey: target.routingKey,
    })
    const result = await postPagerDutyEvent(body)
    if (result.ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: result.ok,
      error: result.error,
      channel: `pagerduty:${target.serviceName}`,
    })
  }

  return anyDelivered
}
