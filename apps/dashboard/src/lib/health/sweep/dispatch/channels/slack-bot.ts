/**
 * Slack bot delivery for a webhook route with a channel id (#4241, #4246).
 *
 * When findings go to a Slack incoming-webhook URL whose route names a
 * `slackChannelId`, and the Slack app is installed in that webhook's workspace
 * (`slack_installations`, keyed by the team id in the URL), they post through
 * the bot as ONE standing message per target:
 *
 *  - the message shows the open counts and is edited in place every sweep;
 *  - what changed this sweep (`+N new`, `N resolved`, a digest table, or one
 *    finding's details) is a reply in its thread;
 *  - when nothing is open any more it is edited to `✅ All clear`.
 *
 * The standing message's `ts` is the thread root in `alert-thread-store`
 * (channel `'slack'`), so it needs the metadata DB, as the Slack app does. If
 * the stored message cannot be edited (say it was deleted) a new one is posted.
 * Returns `null` whenever the bot path does not apply or its first call fails:
 * the caller then posts through the webhook exactly as before.
 *
 * SECURITY: the bot token is decrypted in memory only; nothing here logs it,
 * and failures log the Slack error code only.
 */

import type { SlackOpenCounts } from './../../../adapters/slack'

import { buildSlackBotStandingParent } from './../../../adapters/slack'
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
  /** The standing message's `ts`, when one is stored. */
  rootTs: string | undefined
  /** Open findings after this sweep. */
  open: SlackOpenCounts
  /** What changed this sweep, posted in the standing message's thread. */
  change: Record<string, unknown>
}

export interface SlackBotSendResult {
  ok: true
  /** The standing message `ts` (the thread root). */
  messageId: string
  /** Nothing is open any more: the caller drops the stored root. */
  cleared: boolean
}

/**
 * Deliver one sweep's changes through the Slack bot, or return `null` to fall
 * back to the webhook post. Never throws.
 */
export async function sendSlackBotDigest(
  params: SlackBotSendParams
): Promise<SlackBotSendResult | null> {
  const { url, channelId: channel, rootTs, open, change } = params
  const teamId = slackWebhookTeamId(url)
  if (!teamId) return null
  const cleared = open.critical + open.warning === 0
  // Nothing open and no standing message to close: nothing to say here.
  if (cleared && !rootTs) return null

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

  const message = { ...buildSlackBotStandingParent(open) }
  let parentTs: string | undefined
  if (rootTs) {
    const updated = await updateChatMessage({
      botToken,
      channel,
      ts: rootTs,
      message,
    })
    if (updated.ok) parentTs = rootTs
    else if (cleared) return fallback('chat.update (all clear)', updated.error)
    else warn(`chat.update failed (${updated.error}); posting anew`)
  }
  if (!parentTs) {
    const posted = await postChatMessage({ botToken, channel, message })
    if (!posted.ok || !posted.ts) {
      return fallback('chat.postMessage', posted.error ?? 'no ts')
    }
    parentTs = posted.ts
  }

  const reply = await postChatMessage({
    botToken,
    channel,
    message: { ...change, thread_ts: parentTs },
  })
  if (!reply.ok) warn(`thread reply failed (${reply.error})`)
  return { ok: true, messageId: parentTs, cleared }
}
