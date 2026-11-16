/**
 * Slack bot sends for a webhook route with a channel id, and for a bot-only
 * target, without the OAuth install: the env token (SLACK_BOT_TOKEN) posts,
 * wins over an install, and is never logged. The bot name and icon go on every
 * chat.postMessage and drop away when the token lacks chat:write.customize.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

const ENV_TOKEN = 'xoxb-env-secret-token'
const INSTALL_TOKEN = 'xoxb-install-secret-token'
const TEAM = 'T0TEAM'
const HOOK = `https://hooks.slack.com/services/${TEAM}/B0HOOK/xyz`
const CHANNEL = 'C0ALERTS'

let installed = false
const realInstallStore = {
  ...(await import('../../../../slack/install-store')),
}
mock.module('../../../../slack/install-store', () => ({
  ...realInstallStore,
  getInstallation: async (teamId: string) =>
    installed && teamId === TEAM
      ? {
          teamId,
          botToken: INSTALL_TOKEN,
          ownerRef: '',
          installedAt: 0,
          updatedAt: 0,
        }
      : null,
}))

afterAll(() => {
  mock.module('../../../../slack/install-store', () => ({
    ...realInstallStore,
  }))
})

const { sendSlackBot } = await import('./slack-bot')
const { ErrorLogger } = await import('@chm/logger')
const { resolveSlackTarget } = await import('../../../../slack/target')
const { getSlackBotToken } = await import('../../../../slack/config')

/** The webhook route with a channel id, resolved as the sweep does. */
function routeTarget() {
  const target = resolveSlackTarget(
    { url: HOOK, channelId: CHANNEL },
    { botToken: getSlackBotToken() !== undefined }
  )
  if (target?.kind !== 'bot') throw new Error('expected a bot target')
  return target
}

interface Sent {
  method: string
  auth: string | null
  body: Record<string, unknown>
}

const ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_BOT_NAME',
  'SLACK_BOT_ICON_EMOJI',
  'HEALTH_ALERT_INSTANCE_NAME',
]
const realFetch = globalThis.fetch
let savedEnv: Record<string, string | undefined> = {}
let sent: Sent[] = []
let nextTs = 1
/** Answer for a call, by method and whether it carried a bot name. */
let answer: (s: Sent) => Record<string, unknown> | 'throw' = () => ({
  ok: true,
})

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  installed = false
  sent = []
  nextTs = 1
  answer = () => ({ ok: true })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const s: Sent = {
      method: String(input).replace('https://slack.com/api/', ''),
      auth: headers.get('authorization'),
      body: JSON.parse(String(init?.body)),
    }
    sent.push(s)
    const a = answer(s)
    if (a === 'throw') {
      throw new Error(`request failed: ${headers.get('authorization')}`)
    }
    return Response.json({ ts: `${nextTs++}.0001`, ...a })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const change = { text: 'disk full on ch-1' }
const firing = { rootTs: undefined, open: { critical: 1, warning: 0 }, change }

/**
 * Capture what is logged while `fn` runs. Spies on the logger as well as the
 * console: another test file may have replaced `@chm/logger` with no-ops.
 */
async function captureLogs(fn: () => Promise<unknown>) {
  const logged: unknown[] = []
  const record = (...args: unknown[]) => {
    logged.push(...args)
  }
  const spies = [
    ...(['log', 'warn', 'error'] as const).map((level) =>
      spyOn(console, level).mockImplementation(record)
    ),
    spyOn(ErrorLogger, 'logWarning').mockImplementation(record),
    spyOn(ErrorLogger, 'logError').mockImplementation(record),
  ]
  try {
    return { result: await fn(), logs: JSON.stringify(logged) }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

describe('Slack bot token sources', () => {
  test('the env token posts for a webhook route with no OAuth install', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    const res = await sendSlackBot(routeTarget(), firing)
    expect(res).toEqual({ ok: true, rootTs: '1.0001', replyTs: '2.0001' })
    expect(
      sent.map((s) => [s.method, s.auth, s.body.channel, s.body.thread_ts])
    ).toEqual([
      ['chat.postMessage', `Bearer ${ENV_TOKEN}`, CHANNEL, undefined],
      ['chat.postMessage', `Bearer ${ENV_TOKEN}`, CHANNEL, '1.0001'],
    ])
  })

  test('the env token wins over an install for the same workspace', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    installed = true
    await sendSlackBot(routeTarget(), firing)
    expect(sent.map((s) => s.auth)).toEqual([
      `Bearer ${ENV_TOKEN}`,
      `Bearer ${ENV_TOKEN}`,
    ])
  })

  test('without an env token the install posts; without either nothing is sent', async () => {
    installed = true
    expect(await sendSlackBot(routeTarget(), firing)).toEqual({
      ok: true,
      rootTs: '1.0001',
      replyTs: '2.0001',
    })
    expect(sent.map((s) => s.auth)).toEqual([
      `Bearer ${INSTALL_TOKEN}`,
      `Bearer ${INSTALL_TOKEN}`,
    ])
    installed = false
    sent = []
    expect(await sendSlackBot(routeTarget(), firing)).toEqual({
      ok: false,
      error: 'no_bot_token',
    })
    expect(sent).toEqual([])
  })

  test('a user token in SLACK_BOT_TOKEN is ignored in favour of the install', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxp-user-secret-token'
    installed = true
    const { logs } = await captureLogs(() =>
      sendSlackBot(routeTarget(), firing)
    )
    expect(sent.map((s) => s.auth)).toEqual([
      `Bearer ${INSTALL_TOKEN}`,
      `Bearer ${INSTALL_TOKEN}`,
    ])
    expect(logs).not.toContain('xoxp-user-secret-token')
  })

  test('a bot-only target posts with the env token, no webhook URL and no install', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    const res = await sendSlackBot(
      { kind: 'bot', token: { source: 'env' }, channel: CHANNEL },
      firing
    )
    expect(res).toEqual({ ok: true, rootTs: '1.0001', replyTs: '2.0001' })
    expect(sent.map((s) => [s.method, s.auth, s.body.channel])).toEqual([
      ['chat.postMessage', `Bearer ${ENV_TOKEN}`, CHANNEL],
      ['chat.postMessage', `Bearer ${ENV_TOKEN}`, CHANNEL],
    ])
  })
})

describe('Slack bot name and icon', () => {
  test('every post carries the instance name and icon; the edit does not', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    process.env.HEALTH_ALERT_INSTANCE_NAME = 'prod-eu'
    process.env.SLACK_BOT_ICON_EMOJI = ':rotating_light:'
    await sendSlackBot(routeTarget(), firing)
    await sendSlackBot(routeTarget(), { ...firing, rootTs: '1.0001' })
    expect(
      sent.map((s) => [s.method, s.body.username, s.body.icon_emoji])
    ).toEqual([
      ['chat.postMessage', 'prod-eu', ':rotating_light:'],
      ['chat.postMessage', 'prod-eu', ':rotating_light:'],
      ['chat.update', undefined, undefined],
      ['chat.postMessage', 'prod-eu', ':rotating_light:'],
    ])
  })

  test('SLACK_BOT_NAME wins over the instance name', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    process.env.HEALTH_ALERT_INSTANCE_NAME = 'prod-eu'
    process.env.SLACK_BOT_NAME = 'chmonitor alerts'
    await sendSlackBot(routeTarget(), firing)
    expect(sent.map((s) => s.body.username)).toEqual([
      'chmonitor alerts',
      'chmonitor alerts',
    ])
  })

  test('a token without chat:write.customize still delivers, as the plain bot', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    process.env.HEALTH_ALERT_INSTANCE_NAME = 'prod-eu'
    answer = (s) =>
      s.body.username ? { ok: false, error: 'missing_scope' } : { ok: true }
    const res = await sendSlackBot(routeTarget(), firing)
    expect(res).toEqual({ ok: true, rootTs: '2.0001', replyTs: '4.0001' })
    expect(sent.map((s) => [s.body.username, s.body.thread_ts])).toEqual([
      ['prod-eu', undefined],
      [undefined, undefined],
      ['prod-eu', '2.0001'],
      [undefined, '2.0001'],
    ])
  })
})

describe('a failed edit of the standing message', () => {
  const open = { rootTs: '1.0001', open: { critical: 1, warning: 0 }, change }
  const allClear = {
    rootTs: '1.0001',
    open: { critical: 0, warning: 0 },
    change,
  }
  const updateFails = (error: string) => {
    answer = (s) =>
      s.method === 'chat.update' ? { ok: false, error } : { ok: true }
  }

  test('a rate limit keeps the message: nothing new is posted and the error is reported', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    updateFails('ratelimited')
    for (const params of [open, allClear]) {
      sent = []
      expect(await sendSlackBot(routeTarget(), params)).toEqual({
        ok: false,
        error: 'ratelimited',
      })
      expect(sent.map((s) => s.method)).toEqual(['chat.update'])
    }
  })

  test('a deleted message is replaced while alerts are open', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    updateFails('message_not_found')
    expect(await sendSlackBot(routeTarget(), open)).toEqual({
      ok: true,
      rootTs: '2.0001',
      replyTs: '3.0001',
    })
    expect(sent.map((s) => [s.method, s.body.thread_ts])).toEqual([
      ['chat.update', undefined],
      ['chat.postMessage', undefined],
      ['chat.postMessage', '2.0001'],
    ])
  })
})

describe('Slack bot token safety', () => {
  test('a Slack error falls back and logs the code, never the token', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    answer = () => ({ ok: false, error: 'channel_not_found' })
    const { result, logs } = await captureLogs(() =>
      sendSlackBot(routeTarget(), firing)
    )
    expect(result).toEqual({ ok: false, error: 'channel_not_found' })
    expect(logs).toContain('channel_not_found')
    expect(logs).not.toContain(ENV_TOKEN)
  })

  test('a network error that echoes the request logs no token', async () => {
    process.env.SLACK_BOT_TOKEN = ENV_TOKEN
    answer = () => 'throw'
    const { result, logs } = await captureLogs(() =>
      sendSlackBot(
        { kind: 'bot', token: { source: 'env' }, channel: CHANNEL },
        firing
      )
    )
    expect(result).toEqual({ ok: false, error: 'network' })
    expect(logs).toContain('network')
    expect(logs).not.toContain(ENV_TOKEN)
  })
})
