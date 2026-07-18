/**
 * Precedence tests for `resolveServerChannels` (#2665): a saved D1 row for a
 * channel wins over the env fallback; with no row (the OSS default, since the
 * fake D1 returns []) every channel falls back to its `getServer*Config()` env
 * reader unchanged.
 *
 * `@chm/platform` is mocked via the shared health platform mock; a mutable
 * `channelRows` seeds what the store's SELECT returns.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

interface FakeConfigRow {
  owner_id: string
  channel: string
  enabled: number
  min_severity: string | null
  target_json: string | null
  secret: string | null
  updated_at: number
}

let channelRows: FakeConfigRow[] = []

const fakeDb = {
  prepare(_sql: string) {
    return {
      bind(..._params: unknown[]) {
        return {
          async run() {
            return { meta: { changes: 0 } }
          },
          async all<T>() {
            return { results: channelRows as T[] }
          },
        }
      },
    }
  },
}

installHealthPlatformMock(() => fakeDb)

const { resolveServerChannels } = await import('./server-channel-resolve')

const ENV_KEYS = [
  'HEALTH_ALERT_WEBHOOK_URL',
  'HEALTH_ALERT_HEALTHCHECKS_URL',
  'HEALTH_ALERT_OPSGENIE_API_KEY',
  'HEALTH_ALERT_OPSGENIE_REGION',
  'HEALTH_ALERT_TELEGRAM_BOT_TOKEN',
  'HEALTH_ALERT_TELEGRAM_CHAT_ID',
  'HEALTH_ALERT_WEBHOOK_ENABLED',
  'HEALTH_ALERT_WEBHOOK_MIN_SEVERITY',
] as const
const saved: Record<string, string | undefined> = {}

function row(over: Partial<FakeConfigRow>): FakeConfigRow {
  return {
    owner_id: '',
    channel: 'opsgenie',
    enabled: 1,
    min_severity: null,
    target_json: null,
    secret: null,
    updated_at: 0,
    ...over,
  }
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  channelRows = []
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('resolveServerChannels — env fallback (no D1 rows)', () => {
  test('falls back to env for every channel when there are no rows', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/env'
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'env-key'
    process.env.HEALTH_ALERT_OPSGENIE_REGION = 'eu'
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = 'env-bot'
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = 'env-chat'

    const resolved = await resolveServerChannels('')
    expect(resolved.webhookUrl).toBe('https://hooks.slack.com/env')
    expect(resolved.opsgenie).toEqual({ apiKey: 'env-key', region: 'eu' })
    expect(resolved.telegram).toEqual({
      botToken: 'env-bot',
      chatId: 'env-chat',
    })
    expect(resolved.channelSettings).toEqual({})
  })

  test('env per-channel settings flow through when no rows override them', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_ENABLED = 'false'
    const resolved = await resolveServerChannels('')
    expect(resolved.channelSettings).toEqual({ webhook: { enabled: false } })
  })
})

describe('resolveServerChannels — D1 row wins over env', () => {
  test('a saved opsgenie row overrides the env key + region', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'env-key'
    process.env.HEALTH_ALERT_OPSGENIE_REGION = 'us'
    channelRows = [
      row({
        channel: 'opsgenie',
        secret: 'd1-key',
        target_json: JSON.stringify({ region: 'eu' }),
        min_severity: 'critical',
        enabled: 1,
      }),
    ]
    const resolved = await resolveServerChannels('')
    expect(resolved.opsgenie).toEqual({ apiKey: 'd1-key', region: 'eu' })
    // The row's enabled + minSeverity also feed the per-channel gate.
    expect(resolved.channelSettings.opsgenie).toEqual({
      enabled: true,
      minSeverity: 'critical',
    })
  })

  test('a saved webhook row overrides the env webhook URL', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/env'
    channelRows = [
      row({
        channel: 'webhook',
        target_json: JSON.stringify({ url: 'https://hooks.slack.com/d1' }),
        enabled: 1,
      }),
    ]
    const resolved = await resolveServerChannels('')
    expect(resolved.webhookUrl).toBe('https://hooks.slack.com/d1')
  })

  test('an incomplete D1 row resolves to null even when env is configured (D1 is authoritative)', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'env-key'
    // Row exists but has no secret → misconfigured → null, does NOT fall back.
    channelRows = [row({ channel: 'opsgenie', secret: null, enabled: 1 })]
    const resolved = await resolveServerChannels('')
    expect(resolved.opsgenie).toBeNull()
  })

  test('a disabled twilio row resolves to null (twilio carries its own gate)', async () => {
    channelRows = [
      row({
        channel: 'twilio',
        enabled: 0,
        secret: 'auth',
        target_json: JSON.stringify({
          accountSid: 'AC1',
          from: '+1555',
          to: '+1666',
        }),
      }),
    ]
    const resolved = await resolveServerChannels('')
    expect(resolved.twilio).toBeNull()
  })

  test('an enabled twilio row resolves with its own minSeverity floor', async () => {
    channelRows = [
      row({
        channel: 'twilio',
        enabled: 1,
        min_severity: 'warning',
        secret: 'auth',
        target_json: JSON.stringify({
          accountSid: 'AC1',
          from: '+1555',
          to: '+1666, +1777',
        }),
      }),
    ]
    const resolved = await resolveServerChannels('')
    expect(resolved.twilio).toEqual({
      accountSid: 'AC1',
      authToken: 'auth',
      from: '+1555',
      to: ['+1666', '+1777'],
      minSeverity: 'warning',
    })
    // twilio is intentionally NOT part of the generic channelSettings map —
    // it is not an AlertChannelId, so the assertion must go through a wider
    // record type to even express "the key is absent".
    expect(
      (resolved.channelSettings as Record<string, unknown>).twilio
    ).toBeUndefined()
  })
})
