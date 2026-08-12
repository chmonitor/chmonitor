/**
 * ntfy topic fan-out (#2657), extracted verbatim in #2938.
 */

import type { NtfyTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { dispatchNtfy } from './../../../ntfy-dispatch'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'

/**
 * ntfy: every resolved topic (matched routes, or the env-configured global
 * topic when nothing matched). `dispatchNtfy` renders the header + plain-text
 * body and never throws (fails open), matching every other channel. Returns
 * whether ANY topic delivered.
 */
export async function dispatchNtfyChannel(
  finding: FindingContext,
  ntfyTargets: NtfyTarget[]
): Promise<boolean> {
  let anyDelivered = false

  for (const target of ntfyTargets) {
    const ok = await dispatchNtfy(buildChannelPayload(finding), {
      url: target.url,
      token: target.token,
    })
    if (ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: ok,
      error: ok ? undefined : 'ntfy dispatch failed',
      channel: 'ntfy',
    })
  }

  return anyDelivered
}
