/**
 * ntfy topic fan-out (#2657), extracted verbatim in #2938.
 */

import type { NtfyTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { dispatchNtfy } from './../../../ntfy-dispatch'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'
import { debug } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

const isSameTarget = (a: NtfyTarget, b: NtfyTarget | null) =>
  b !== null && a.url === b.url && (a.token ?? '') === (b.token ?? '')

/**
 * ntfy: every resolved topic (matched routes, or the env-configured global
 * topic when nothing matched). `dispatchNtfy` renders the header + plain-text
 * body and never throws (fails open), matching every other channel. Returns
 * whether ANY topic delivered.
 *
 * A saved route's topic URL is re-validated against the SSRF guard right
 * before sending (DNS can change after save) and never follows redirects, so
 * the access token cannot be sent to an internal address. `envTarget` is the
 * operator-configured topic, compared by value; it is trusted (LAN servers)
 * and skips both. A blocked target is recorded as not delivered, with no
 * URL or token logged, and never fetched.
 */
export async function dispatchNtfyChannel(
  finding: FindingContext,
  ntfyTargets: NtfyTarget[],
  envTarget: NtfyTarget | null
): Promise<boolean> {
  let anyDelivered = false

  for (const target of ntfyTargets) {
    const trusted = isSameTarget(target, envTarget)
    if (!trusted && (await validateHostUrl(target.url))) {
      debug('[health-sweep] skipping ntfy target: blocked destination')
      await recordChannelEvent(finding, {
        delivered: false,
        error: 'ntfy dispatch failed (destination blocked)',
        channel: 'ntfy',
      })
      continue
    }
    const ok = await dispatchNtfy(
      buildChannelPayload(finding),
      { url: target.url, token: target.token },
      trusted ? {} : { redirect: 'error' }
    )
    if (ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: ok,
      error: ok ? undefined : 'ntfy dispatch failed',
      channel: 'ntfy',
    })
  }

  return anyDelivered
}
