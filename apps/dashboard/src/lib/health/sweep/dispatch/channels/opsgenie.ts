/**
 * Opsgenie alert dispatch (plan 26), extracted verbatim in #2938.
 */

import type { ServerOpsgenieConfig } from './../../../server-alert-config'
import type { FindingContext } from './../finding-context'

import { dispatchOpsgenie } from './../../../opsgenie-dispatch'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'

/**
 * Opsgenie: a single global env-configured destination (no per-route
 * resolution yet, unlike webhook/PagerDuty targets) — the caller fires this
 * whenever `opsgenieConfig` is set and the channel gate passes.
 * `dispatchOpsgenie` never throws (fails open), matching every other channel.
 */
export async function dispatchOpsgenieChannel(
  finding: FindingContext,
  opsgenieConfig: ServerOpsgenieConfig
): Promise<boolean> {
  const ok = await dispatchOpsgenie(
    buildChannelPayload(finding),
    opsgenieConfig
  )

  await recordChannelEvent(finding, {
    delivered: ok,
    error: ok ? undefined : 'Opsgenie dispatch failed',
    channel: 'opsgenie',
  })

  return ok
}
