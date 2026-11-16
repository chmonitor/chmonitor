/**
 * Slack bot delivery (#4241, #4246): one standing message per target.
 *
 * A webhook alert route that names a `slackChannelId` posts through a bot
 * instead of the webhook, as ONE standing message per target:
 *
 *  - the message shows the open counts and is edited in place every sweep;
 *  - what changed this sweep (`+N new`, `N resolved`, a digest table, or one
 *    finding's details) is a reply in its thread;
 *  - when nothing is open any more it is edited to `✅ All clear`.
 *
 * The bot token is `SLACK_BOT_TOKEN` when the operator set one, else the OAuth
 * install for the webhook's workspace (`slack_installations`, keyed by the team
 * id in the URL). Posts carry the bot name and icon from `SLACK_BOT_NAME` /
 * `HEALTH_ALERT_INSTANCE_NAME` and `SLACK_BOT_ICON_EMOJI`.
 *
 * The standing message's `ts` is the thread root in `alert-thread-store`
 * (channel `'slack'`), so it needs the metadata DB. If the stored message
 * cannot be edited (say it was deleted) a new one is posted. Returns `null`
 * whenever the bot path does not apply or its first call fails: the caller
 * then posts through the webhook exactly as before.
 *
 * SECURITY: the bot token is read or decrypted in memory only; nothing here
 * logs it, and failures log the Slack error code only.
 */

import type { SlackBotIdentity } from '@/lib/slack/config'
import type { SlackBotTarget, SlackBotTokenSource } from '@/lib/slack/target'
import type { SlackOpenCounts } from './../../../adapters/slack'

import { buildSlackBotStandingParent } from './../../../adapters/slack'
import { getServerAlertIdentity } from './../../../server-alert-config'
import { ErrorLogger } from '@chm/logger'
import { postChatMessage, updateChatMessage } from '@/lib/slack/api'
import { getSlackBotIdentity, getSlackBotToken } from '@/lib/slack/config'
import { getInstallation } from '@/lib/slack/install-store'
import { resolveSlackTarget } from '@/lib/slack/target'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[slack-bot-alert] ${msg}`, {
    component: 'slack-bot-alert',
  })

/** One sweep's change for a target's standing message. */
export interface SlackBotChange {
  /** The standing message's `ts`, when one is stored. */
  rootTs: string | undefined
  /** Open findings after this sweep. */
  open: SlackOpenCounts
  /** What changed this sweep, posted in the standing message's thread. */
  change: Record<string, unknown>
}

export interface SlackBotSendParams extends SlackBotChange {
  /** The route's Slack incoming-webhook URL. */
  url: string
  channelId: string
}

export interface SlackBotSendResult {
  ok: true
  /** The standing message `ts` (the thread root). */
  messageId: string
  /** Nothing is open any more: the caller drops the stored root. */
  cleared: boolean
}

/**
 * Read the bot token a target names. Neither source checks who owns the
 * route: the install is picked by the team id in the URL, and the env token is
 * the operator's and ignores that team id, so any route with a channel id can
 * make it post into any channel the bot is in, private ones included. Safe
 * only because the sweep dispatches operator routes alone
 * (SWEEP_ROUTING_OWNER_ID). Dispatching per-user routes must bind the
 * install's ownerRef to the route owner first and must never hand a user
 * route the env token, or any user could post as the operator's bot.
 */
async function loadBotToken(
  token: SlackBotTokenSource
): Promise<string | null> {
  if (token.source === 'env') return getSlackBotToken() ?? null
  const install = await getInstallation(token.teamId)
  return install?.botToken ?? null
}

/** The bot name defaults to the deployment's instance name. */
function botIdentity(): SlackBotIdentity {
  const { username, iconEmoji } = getSlackBotIdentity()
  const name = username ?? getServerAlertIdentity().instanceName
  return {
    ...(name ? { username: name } : {}),
    ...(iconEmoji ? { iconEmoji } : {}),
  }
}

function describeTarget(target: SlackBotTarget): string {
  const token =
    target.token.source === 'env'
      ? 'the env token'
      : `the install for team ${target.token.teamId}`
  return `channel ${target.channel} via ${token}`
}

/**
 * Deliver one sweep's changes for a webhook route with a channel id, or
 * return `null` to fall back to the webhook post. Never throws.
 */
export function sendSlackBotDigest(
  params: SlackBotSendParams
): Promise<SlackBotSendResult | null> {
  const target = resolveSlackTarget(
    { url: params.url, channelId: params.channelId },
    { botToken: getSlackBotToken() !== undefined }
  )
  return target?.kind === 'bot'
    ? sendSlackBot(target, params)
    : Promise.resolve(null)
}

/**
 * Deliver one sweep's changes to a bot target, or return `null` when there
 * is no token or the first call fails. Never throws.
 */
export async function sendSlackBot(
  target: SlackBotTarget,
  params: SlackBotChange
): Promise<SlackBotSendResult | null> {
  const { rootTs, open, change } = params
  const { channel } = target
  const cleared = open.critical + open.warning === 0
  // Nothing open and no standing message to close: nothing to say here.
  if (cleared && !rootTs) return null

  const botToken = await loadBotToken(target.token)
  if (!botToken) return null
  const identity = botIdentity()

  const fallback = (step: string, error: string | undefined) => {
    const next = target.fallbackUrl ? '; posting through the webhook' : ''
    warn(
      `${step} failed for ${describeTarget(target)} (${error ?? 'unknown'})${next}`
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
    const posted = await postChatMessage({
      botToken,
      channel,
      message,
      identity,
    })
    if (!posted.ok || !posted.ts) {
      return fallback('chat.postMessage', posted.error ?? 'no ts')
    }
    parentTs = posted.ts
  }

  const reply = await postChatMessage({
    botToken,
    channel,
    message: { ...change, thread_ts: parentTs },
    identity,
  })
  if (!reply.ok) warn(`thread reply failed (${reply.error})`)
  return { ok: true, messageId: parentTs, cleared }
}
