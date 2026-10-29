import { parseSlackChannelId, slackWebhookTeamId } from './channel-id'
import { describe, expect, test } from 'bun:test'

describe('parseSlackChannelId', () => {
  test('empty or missing turns the bot path off', () => {
    expect(parseSlackChannelId(undefined)).toBeNull()
    expect(parseSlackChannelId(null)).toBeNull()
    expect(parseSlackChannelId('  ')).toBeNull()
  })

  test('accepts channel, private group and DM ids', () => {
    expect(parseSlackChannelId(' C0123ABC ')).toBe('C0123ABC')
    expect(parseSlackChannelId('G0123')).toBe('G0123')
    expect(parseSlackChannelId('D0123')).toBe('D0123')
  })

  test('rejects names, lowercase and other shapes', () => {
    expect(parseSlackChannelId('#alerts')).toBe('invalid')
    expect(parseSlackChannelId('c0123')).toBe('invalid')
    expect(parseSlackChannelId('U0123')).toBe('invalid')
    expect(parseSlackChannelId(42)).toBe('invalid')
  })
})

describe('slackWebhookTeamId', () => {
  test('reads the team id from an incoming-webhook URL', () => {
    expect(
      slackWebhookTeamId('https://hooks.slack.com/services/T0TEAM/B0X/secret')
    ).toBe('T0TEAM')
  })

  test('returns null for anything else', () => {
    expect(
      slackWebhookTeamId('https://discord.com/api/webhooks/1/x')
    ).toBeNull()
    expect(
      slackWebhookTeamId('https://hooks.slack.com.evil.test/services/T0/B/x')
    ).toBeNull()
    expect(slackWebhookTeamId('not a url')).toBeNull()
  })
})
