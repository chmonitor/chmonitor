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
 * posts a new message. If the stored message is gone (deleted, or its channel
 * is) a new one is posted. A send whose first call fails reports the error,
 * and so does any other failed edit (a rate limit, the network), which keeps
 * the stored message: the caller then posts through the target's webhook,
 * when it has one.
 *
 * SECURITY: the bot token is read or decrypted in memory only; nothing here
 * logs it, and failures log the Slack error code only.
 */

import type { SlackBotIdentity } from '@/lib/slack/config'
import type { SlackBotTarget, SlackBotTokenSource } from '@/lib/slack/target'
import type { SlackOpenCounts } from './../../../adapters/slack'
import type { AlertDecision } from './../../../alert-state-store'

import { buildSlackBotStandingParent } from './../../../adapters/slack'
import { getServerAlertIdentity } from './../../../server-alert-config'
import { ErrorLogger } from '@chm/logger'
import {
  addReaction,
  postChatMessage,
  removeReaction,
  updateChatMessage,
} from '@/lib/slack/api'
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

/** chat.update errors that mean the standing message can never be edited. */
const GONE_MESSAGE_ERRORS = new Set([
  'message_not_found',
  'cant_update_message',
  'channel_not_found',
])

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
      /** The change this sweep posted, when Slack accepted it. */
      replyTs: string | undefined
      /** Whether Slack accepted the change; the standing edit alone is `ok`. */
      replied: boolean
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
    if (!updated.ok && !GONE_MESSAGE_ERRORS.has(updated.error ?? '')) {
      return fail('chat.update', updated.error)
    }
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
    return { ok: true, rootTs: undefined, replyTs: posted.ts, replied: true }
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
  return {
    ok: true,
    rootTs: cleared ? undefined : parentTs,
    replyTs: reply.ok ? reply.ts : undefined,
    replied: reply.ok,
  }
}

/** Slack emoji names (no colons) for a firing alert, by severity. */
const FIRING_REACTIONS = {
  critical: 'red_circle',
  warning: 'large_orange_circle',
} as const

const RESOLVED_REACTION = 'white_check_mark'

/** Added to the message whose Acknowledge button was clicked. */
export const ACK_REACTION = 'eyes'

/** A reaction change on one message: `add` first, then each of `remove`. */
export interface SlackReactionStep {
  ts: string
  add: string
  remove: readonly string[]
}

/**
 * The reaction one decision sets on its episode's details message: the
 * severity while it fires, a check mark once resolved. On a message that
 * already shows a state (`onStored`) every other firing reaction is removed,
 * so it converges whatever it showed before: a de-escalation sends nothing
 * and leaves 🔴, which the recovery still clears. Null when the decision has
 * no state to show.
 */
export function slackReactionStep(
  decision: Pick<AlertDecision, 'kind' | 'severity'>,
  ts: string,
  onStored: boolean
): SlackReactionStep | null {
  const add =
    decision.kind === 'recovery'
      ? RESOLVED_REACTION
      : decision.severity === 'critical' || decision.severity === 'warning'
        ? FIRING_REACTIONS[decision.severity]
        : null
  if (!add) return null
  const remove = onStored
    ? Object.values(FIRING_REACTIONS).filter((name) => name !== add)
    : []
  return { ts, add, remove }
}

/**
 * Set reactions on a bot target's messages. Reactions only decorate an alert
 * that was already delivered: `skipped` (already set, already gone, or a
 * token without `reactions:write`) is silent, a failure logs its Slack code,
 * and nothing here fails or re-sends the alert. Never throws.
 */
export async function reactSlackBot(
  target: SlackBotTarget,
  steps: readonly SlackReactionStep[]
): Promise<void> {
  if (steps.length === 0) return
  const botToken = await loadBotToken(target.token)
  if (!botToken) return
  const { channel } = target
  for (const { ts, add, remove } of steps) {
    const results = [await addReaction({ botToken, channel, ts, name: add })]
    for (const name of remove) {
      results.push(await removeReaction({ botToken, channel, ts, name }))
    }
    for (const result of results) {
      if (result.status === 'failed') {
        warn(`reaction failed for ${describeTarget(target)} (${result.error})`)
      }
    }
  }
}
