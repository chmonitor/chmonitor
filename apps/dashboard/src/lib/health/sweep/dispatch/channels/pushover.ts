/**
 * Pushover recipient fan-out (#2659), extracted verbatim in #2938.
 */

import type { PushoverTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { dispatchPushover } from './../../../pushover-dispatch'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'

/**
 * Pushover: every resolved recipient (matched routes, or the env-configured
 * global recipient when nothing matched). `dispatchPushover` renders the JSON
 * body and never throws (fails open), matching every other channel. Returns
 * whether ANY recipient delivered.
 */
export async function dispatchPushoverChannel(
  finding: FindingContext,
  pushoverTargets: PushoverTarget[]
): Promise<boolean> {
  let anyDelivered = false

  for (const target of pushoverTargets) {
    const ok = await dispatchPushover(buildChannelPayload(finding), {
      token: target.token,
      user: target.user,
    })
    if (ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: ok,
      error: ok ? undefined : 'Pushover dispatch failed',
      channel: 'pushover',
    })
  }

  return anyDelivered
}
