/**
 * Slack bot delivery (#4241, #4246): one standing message per target.
 *
 * A bot target (a webhook route with a `slackChannelId`, or the
 * `SLACK_ALERT_CHANNEL_ID` channel with no webhook at all) posts as ONE
 * standing message per target:
 *
 *  - the message shows the open counts and is edited in place every sweep;
 *  - what changed this sweep (`+N new`, `N resolved`, a digest, or one
 *    finding's details) is a reply in its thread;
 *  - when nothing is open any more it is edited to `✅ All clear`.
 *
 * The bot token is `SLACK_BOT_TOKEN` when the operator set one, else the OAuth
 * install for the webhook's workspace (`slack_installations`, keyed by the team
 * id in the URL). Posts carry the bot name and icon from `SLACK_BOT_NAME` /
 * `HEALTH_ALERT_INSTANCE_NAME` and `SLACK_BOT_ICON_EMOJI`.
 *
 * The standing message's `ts` is the thread root in `alert-thread-store`
 * (channel `'slack'`), so it needs the metadata DB; without one every change
 * posts a new message. If the stored message cannot be edited (say it was
 * deleted) a new one is posted. A send whose first call fails reports the
 * error: the caller then posts through the target's webhook, when it has one.
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

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[slack-bot-alert] ${msg}`, {
    component: 'slack-bot-alert',
  })

/** A bot target as the sweep resolved it; `trusted` covers its fallback URL. */
export interface SlackBotRoute {
  target: SlackBotTarget
  trusted: boolean
}

/**
 * What tells two targets' standing messages apart: the webhook URL (it names
 * the workspace) or the token source, plus the channel. Never the token, so a
 * rotated `SLACK_BOT_TOKEN` keeps editing the same message.
 */
export function slackThreadDestination(target: SlackBotTarget): string[] {
  return [target.fallbackUrl ?? `bot:${target.token.source}`, target.channel]
}

/** One sweep's change for a target's standing message. */
export interface SlackBotChange {
  /** The standing message's `ts`, when one is stored. */
  rootTs: string | undefined
  /** Open findings after this sweep. */
  open: SlackOpenCounts
  /** What changed this sweep, posted in the standing message's thread. */
  change: Record<string, unknown>
}

export type SlackBotSendResult =
  | {
      ok: true
      /** The standing message to keep; undefined once nothing is open. */
      rootTs: string | undefined
    }
  | { ok: false; error: string }

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
 * Deliver one sweep's changes to a bot target. `ok: false` means nothing
 * reached Slack: there is no token, or the first call failed. Never throws.
 */
export async function sendSlackBot(
  target: SlackBotTarget,
  params: SlackBotChange
): Promise<SlackBotSendResult> {
  const { rootTs, open, change } = params
  const { channel } = target
  const cleared = open.critical + open.warning === 0

  const fail = (step: string, error: string | undefined) => {
    const next = target.fallbackUrl ? '; posting through the webhook' : ''
    const code = error ?? 'unknown'
    warn(`${step} failed for ${describeTarget(target)} (${code})${next}`)
    return { ok: false as const, error: code }
  }

  const botToken = await loadBotToken(target.token)
  if (!botToken) return { ok: false, error: 'no_bot_token' }
  const identity = botIdentity()

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
    else warn(`chat.update failed (${updated.error}); posting anew`)
  }
  // Nothing is open and no standing message is left to close (no metadata
  // DB, the stored one is gone, or the alert went out another way): the
  // change goes out on its own instead of opening a new standing message.
  if (cleared && !parentTs) {
    const posted = await postChatMessage({
      botToken,
      channel,
      message: change,
      identity,
    })
    if (!posted.ok) return fail('chat.postMessage', posted.error)
    return { ok: true, rootTs: undefined }
  }
  if (!parentTs) {
    const posted = await postChatMessage({
      botToken,
      channel,
      message,
      identity,
    })
    if (!posted.ok || !posted.ts) {
      return fail('chat.postMessage', posted.error ?? 'no ts')
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
  return { ok: true, rootTs: cleared ? undefined : parentTs }
}
