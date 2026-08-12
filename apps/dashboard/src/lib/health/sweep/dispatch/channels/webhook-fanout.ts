/**
 * Generic webhook fan-out (#2938 split of the inline block).
 *
 * Sends the per-finding message to every matched webhook URL that is NOT
 * digest-capable — Discord / MS Teams / Google Chat keep their inline
 * per-finding sends; Slack + generic webhooks are grouped by `./../digest.ts`.
 */

import type { AlertPayload } from './../../../adapters'
import type { FindingContext } from './../finding-context'

import {
  buildWebhookDispatchBody,
  detectAdapter,
  isDigestCapableWebhook,
} from './../../../adapters'
import { recordChannelEvent } from './../alert-event-record'
import { postWebhook } from './../webhook-post'

/**
 * Digest partition (#2663): Slack / generic-webhook URLs are grouped and
 * flushed later (one combined message per target); Discord / MS Teams /
 * Google Chat keep today's inline per-finding sends. `isDigestCapableWebhook`
 * never matches those rich-embed adapters, so they land in `immediate`.
 */
export function partitionWebhookTargets(targets: string[]): {
  immediate: string[]
  groupable: string[]
} {
  const immediate: string[] = []
  const groupable: string[] = []
  for (const url of targets) {
    if (isDigestCapableWebhook(url)) groupable.push(url)
    else immediate.push(url)
  }
  return { immediate, groupable }
}

/**
 * Dispatch to the non-groupable webhook targets. Returns whether ANY of them
 * delivered (the caller ORs this into the finding's `anyDelivered`).
 */
export async function dispatchWebhookFanoutChannel(
  finding: FindingContext,
  immediateWebhookTargets: string[],
  webhookPayload: AlertPayload
): Promise<boolean> {
  const { text } = finding
  let anyDelivered = false

  for (const url of immediateWebhookTargets) {
    const adapter = detectAdapter(url)

    // Per-URL body selection (#2656): Discord/MS Teams/Google Chat targets
    // get their rich provider bodies. Slack ack-blocks are handled on the
    // grouped path (Slack is digest-capable, never `immediate`).
    const dispatch = buildWebhookDispatchBody({
      url,
      text,
      payload: webhookPayload,
    })
    const result = await postWebhook(url, dispatch.body)
    if (result.ok) anyDelivered = true

    // Best-effort audit trail per channel — `detectAdapter` picks the per-URL
    // channel label (plan 26), so a fan-out to mixed Discord/Teams
    // destinations is audited per its own adapter.
    await recordChannelEvent(finding, {
      delivered: result.ok,
      error: result.error,
      channel: adapter.id,
    })
  }

  return anyDelivered
}
