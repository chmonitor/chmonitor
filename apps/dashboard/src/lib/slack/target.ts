/**
 * Where a Slack alert goes: an incoming webhook, or a channel the bot posts to.
 *
 * Only the bot can edit, thread, react, and post under a custom name, so those
 * calls take a {@link SlackBotTarget} and the compiler keeps them away from a
 * webhook. A target names its token source, never the token: targets may be
 * logged or keyed, and the secret is read only at send time.
 */

import { slackWebhookTeamId } from './channel-id'

export type SlackBotTokenSource =
  /** `SLACK_BOT_TOKEN`: a bot the operator installed by hand. */
  | { source: 'env' }
  /** The OAuth install for this workspace (`slack_installations`). */
  | { source: 'install'; teamId: string }

export type SlackTarget =
  | { kind: 'webhook'; url: string }
  | {
      kind: 'bot'
      token: SlackBotTokenSource
      channel: string
      /** The route's webhook, used when the bot cannot post. */
      fallbackUrl?: string
    }

export type SlackBotTarget = Extract<SlackTarget, { kind: 'bot' }>

/**
 * The Slack target for a destination: a webhook URL, a channel id, or both.
 * A webhook with a channel id posts through the bot (the env token when set,
 * else the install for the webhook's workspace) and keeps the webhook as the
 * fallback. A webhook alone stays a webhook: it is bound to its own channel.
 * A channel with no webhook needs the env token. Anything else is not Slack.
 */
export function resolveSlackTarget(
  dest: { url?: string; channelId?: string },
  env: { botToken: boolean }
): SlackTarget | null {
  const { url, channelId } = dest
  if (url === undefined) {
    return channelId && env.botToken
      ? { kind: 'bot', token: { source: 'env' }, channel: channelId }
      : null
  }
  const teamId = slackWebhookTeamId(url)
  if (!teamId) return null
  if (!channelId) return { kind: 'webhook', url }
  return {
    kind: 'bot',
    token: env.botToken ? { source: 'env' } : { source: 'install', teamId },
    channel: channelId,
    fallbackUrl: url,
  }
}
