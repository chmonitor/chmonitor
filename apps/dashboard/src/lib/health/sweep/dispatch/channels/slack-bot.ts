/**
 * Slack bot delivery for a webhook route with a channel id (#4241).
 *
 * When a lone finding goes to a Slack incoming-webhook URL whose route names a
 * `slackChannelId`, and the Slack app is installed in that webhook's workspace
 * (`slack_installations`, keyed by the team id in the URL), the alert posts
 * through `chat.postMessage` instead:
 *
 *  - firing: one compact parent line, then one thread reply with the details;
 *  - a repeat while the incident is open: the parent is edited in place and
 *    the new details go in its thread;
 *  - recovery: the parent is edited to `✅ RESOLVED …` and the thread gets
 *    `✅ resolved after N min`; no new top-level message.
 *
 * The parent `ts` is the episode's thread root in `alert-thread-store`
 * (channel `'slack'`), so it needs the metadata DB, as the Slack app does.
 * Returns `null` whenever the bot path does not apply or its first call fails:
 * the caller then posts through the webhook exactly as before.
 *
 * SECURITY: the bot token is decrypted in memory only; nothing here logs it,
 * and failures log the Slack error code only.
 */

import type { AlertPayload } from './../../../adapters'
import type { AlertDecisionKind } from './../../../alert-state-store'

import {
  buildSlackBotDetails,
  buildSlackBotParent,
  buildSlackBotResolvedParent,
  buildSlackBotResolvedReply,
} from './../../../adapters/slack'
import { ErrorLogger } from '@chm/logger'
import { postChatMessage, updateChatMessage } from '@/lib/slack/api'
import { slackWebhookTeamId } from '@/lib/slack/channel-id'
import { getInstallation } from '@/lib/slack/install-store'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[slack-bot-alert] ${msg}`, {
    component: 'slack-bot-alert',
  })

export interface SlackBotSendParams {
  /** The route's Slack incoming-webhook URL (only its team id is used). */
  url: string
  channelId: string
  payload: AlertPayload
  kind: AlertDecisionKind
  /** The episode's parent `ts`, when one is stored. */
  rootTs: string | undefined
  /** Extra blocks for the details reply (the ack button). */
  detailBlocks?: readonly unknown[]
}

export interface SlackBotSendResult {
  ok: true
  /** The parent message `ts` (the thread root). */
  messageId: string
}

/**
 * Deliver one finding through the Slack bot, or return `null` to fall back
 * to the webhook post. Never throws.
 */
export async function sendSlackBotAlert(
  params: SlackBotSendParams
): Promise<SlackBotSendResult | null> {
  const { url, channelId: channel, payload, kind, rootTs } = params
  const teamId = slackWebhookTeamId(url)
  if (!teamId) return null
  // A recovery with no bot parent has nothing to edit: post it as before.
  if (kind === 'recovery' && !rootTs) return null

  // The install is picked by the team id in the URL, with no ownership check.
  // Safe only because the sweep dispatches operator routes alone
  // (SWEEP_ROUTING_OWNER_ID). Dispatching per-user routes must bind the
  // install's ownerRef to the route owner first, or any user could post with
  // another workspace's bot.
  const install = await getInstallation(teamId)
  if (!install) return null
  const botToken = install.botToken

  const fallback = (step: string, error: string | undefined) => {
    warn(
      `${step} failed for team ${teamId} channel ${channel} (${error ?? 'unknown'}); posting through the webhook`
    )
    return null
  }

  if (kind === 'recovery' && rootTs) {
    const updated = await updateChatMessage({
      botToken,
      channel,
      ts: rootTs,
      message: { ...buildSlackBotResolvedParent(payload) },
    })
    if (!updated.ok) return fallback('chat.update (resolve)', updated.error)
    const reply = await postChatMessage({
      botToken,
      channel,
      message: { ...buildSlackBotResolvedReply(payload), thread_ts: rootTs },
    })
    if (!reply.ok) warn(`resolved thread reply failed (${reply.error})`)
    return { ok: true, messageId: rootTs }
  }

  // Firing: edit the open incident's parent, or post a new one.
  let parentTs: string | undefined
  if (rootTs) {
    const updated = await updateChatMessage({
      botToken,
      channel,
      ts: rootTs,
      message: { ...buildSlackBotParent(payload) },
    })
    if (updated.ok) parentTs = rootTs
    else warn(`chat.update (repeat) failed (${updated.error}); posting anew`)
  }
  if (!parentTs) {
    const posted = await postChatMessage({
      botToken,
      channel,
      message: { ...buildSlackBotParent(payload) },
    })
    if (!posted.ok || !posted.ts) {
      return fallback('chat.postMessage', posted.error ?? 'no ts')
    }
    parentTs = posted.ts
  }

  const details = await postChatMessage({
    botToken,
    channel,
    message: {
      ...buildSlackBotDetails(payload, params.detailBlocks),
      thread_ts: parentTs,
    },
  })
  if (!details.ok) warn(`details thread reply failed (${details.error})`)
  return { ok: true, messageId: parentTs }
}
