import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const { SLACK_BOT_SCOPES, getSlackBotIdentity, getSlackBotToken } =
  await import('./config')

const KEYS = ['SLACK_BOT_TOKEN', 'SLACK_BOT_NAME', 'SLACK_BOT_ICON_EMOJI']
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('getSlackBotToken', () => {
  test('reads a bot token, trimmed', () => {
    process.env.SLACK_BOT_TOKEN = '  xoxb-1-2-abc  '
    expect(getSlackBotToken()).toBe('xoxb-1-2-abc')
  })

  test('ignores anything that is not a bot token', () => {
    expect(getSlackBotToken()).toBeUndefined()
    process.env.SLACK_BOT_TOKEN = 'xoxb-1-2-abc'
    expect(getSlackBotToken()).toBe('xoxb-1-2-abc')
    process.env.SLACK_BOT_TOKEN = 'xoxp-user-token'
    expect(getSlackBotToken()).toBeUndefined()
    process.env.SLACK_BOT_TOKEN =
      'https://hooks.slack.com/services/T0TEAM/B0HOOK/secret'
    expect(getSlackBotToken()).toBeUndefined()
  })
})

describe('getSlackBotIdentity', () => {
  test('reads the bot name and icon emoji', () => {
    process.env.SLACK_BOT_NAME = 'chmonitor prod'
    process.env.SLACK_BOT_ICON_EMOJI = ':rotating_light:'
    expect(getSlackBotIdentity()).toEqual({
      username: 'chmonitor prod',
      iconEmoji: ':rotating_light:',
    })
  })

  test('adds the colons an icon emoji was set without', () => {
    process.env.SLACK_BOT_ICON_EMOJI = 'rotating_light'
    expect(getSlackBotIdentity()).toEqual({ iconEmoji: ':rotating_light:' })
  })

  test('drops a multi-line or too long name and a malformed icon', () => {
    process.env.SLACK_BOT_NAME = 'chm\nprod'
    process.env.SLACK_BOT_ICON_EMOJI = ':not an emoji:'
    expect(getSlackBotIdentity()).toEqual({})
    process.env.SLACK_BOT_NAME = 'x'.repeat(81)
    expect(getSlackBotIdentity()).toEqual({})
    process.env.SLACK_BOT_NAME = 'x'.repeat(80)
    expect(getSlackBotIdentity()).toEqual({ username: 'x'.repeat(80) })
  })
})

describe('SLACK_BOT_SCOPES', () => {
  test('match the bot scopes in docs/slack/manifest.yml', () => {
    const manifest = parseYaml(
      readFileSync(
        fileURLToPath(
          new URL('../../../../../docs/slack/manifest.yml', import.meta.url)
        ),
        'utf8'
      )
    ) as { oauth_config: { scopes: { bot: string[] } } }
    expect([...manifest.oauth_config.scopes.bot].sort()).toEqual(
      [...SLACK_BOT_SCOPES].sort()
    )
  })
})
