import { resolveSlackTarget } from './target'
import { describe, expect, test } from 'bun:test'

const HOOK = 'https://hooks.slack.com/services/T0TEAM/B0HOOK/secret'

describe('resolveSlackTarget', () => {
  test('a Slack webhook route with a channel id posts through the env bot token', () => {
    expect(
      resolveSlackTarget(
        { url: HOOK, channelId: 'C0ALERTS' },
        { botToken: true }
      )
    ).toEqual({
      kind: 'bot',
      token: { source: 'env' },
      channel: 'C0ALERTS',
      fallbackUrl: HOOK,
    })
  })

  test('without an env token the install for the webhook workspace is used', () => {
    expect(
      resolveSlackTarget(
        { url: HOOK, channelId: 'C0ALERTS' },
        { botToken: false }
      )
    ).toEqual({
      kind: 'bot',
      token: { source: 'install', teamId: 'T0TEAM' },
      channel: 'C0ALERTS',
      fallbackUrl: HOOK,
    })
  })

  test('a Slack webhook route without a channel id stays a webhook, even with a bot token', () => {
    expect(resolveSlackTarget({ url: HOOK }, { botToken: true })).toEqual({
      kind: 'webhook',
      url: HOOK,
    })
  })

  test('a channel with no webhook URL needs the env token', () => {
    expect(
      resolveSlackTarget({ channelId: 'C0ALERTS' }, { botToken: true })
    ).toEqual({ kind: 'bot', token: { source: 'env' }, channel: 'C0ALERTS' })
    expect(
      resolveSlackTarget({ channelId: 'C0ALERTS' }, { botToken: false })
    ).toBeNull()
  })

  test('a URL that is not a Slack webhook is not a Slack target', () => {
    expect(
      resolveSlackTarget(
        { url: 'https://discord.com/api/webhooks/1/x', channelId: 'C0ALERTS' },
        { botToken: true }
      )
    ).toBeNull()
    expect(resolveSlackTarget({}, { botToken: true })).toBeNull()
  })
})
