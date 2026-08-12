/**
 * healthchecks.io ping (#2665), extracted verbatim in #2938.
 */

import type { FindingContext } from './../finding-context'

import { dispatchHealthchecks } from './../../../healthchecks-dispatch'
import { recordChannelEvent } from './../alert-event-record'

/**
 * healthchecks.io: a single ping URL (D1 override or env), gated like every
 * other channel by the caller. A recovery pings `<url>/fail`, an alert pings
 * the base URL — mirroring the client dispatcher exactly (see
 * `healthchecks-dispatch.ts`). `dispatchHealthchecks` never throws (fails
 * open), matching every other channel.
 */
export async function dispatchHealthchecksChannel(
  finding: FindingContext,
  healthchecksUrl: string
): Promise<boolean> {
  const ok = await dispatchHealthchecks(
    healthchecksUrl,
    finding.isRecovery ? 'recovery' : 'alert'
  )

  await recordChannelEvent(finding, {
    delivered: ok,
    error: ok ? undefined : 'healthchecks ping failed',
    channel: 'healthchecks',
  })

  return ok
}
