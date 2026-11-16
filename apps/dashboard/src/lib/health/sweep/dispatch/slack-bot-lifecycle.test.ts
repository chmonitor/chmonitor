/**
 * The Slack bot thread lifecycle, end to end: a bot channel with no webhook
 * URL (SLACK_BOT_TOKEN + SLACK_ALERT_CHANNEL_ID). Drives the real dispatcher
 * against real SQLite thread-root and alert-history tables and a fake Slack
 * Web API that records every call in order.
 */

import type { AlertRoute } from '../../alert-routing'
import type { SweepContext } from '../resolve-config'

import { installHealthPlatformMock } from '../../__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ENV_TOKEN = 'xoxb-env-secret-token'
const INSTALL_TOKEN = 'xoxb-install-secret-token'
const TEAM = 'T0TEAM'
const HOOK = `https://hooks.slack.com/services/${TEAM}/B0HOOK/xyz`
const ENV_CHANNEL = 'C0ENV'
const ROUTE_CHANNEL = 'C0ROUTE'
const SLACK_API = 'https://slack.com/api/'

let installed = false
const realInstallStore = { ...(await import('../../../slack/install-store')) }
mock.module('../../../slack/install-store', () => ({
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
  mock.module('../../../slack/install-store', () => ({ ...realInstallStore }))
})

function sqliteD1(db: Database) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const params = args as (string | number | null)[]
          return {
            async all() {
              return {
                results: db.query(sql).all(...params),
                success: true,
                meta: {},
              }
            },
            async first() {
              return db.query(sql).get(...params) ?? null
            },
            async run() {
              const r = db.query(sql).run(...params)
              return { success: true, meta: { changes: r.changes } }
            },
          }
        },
      }
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      const results: unknown[] = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }
}

let sqlite: Database | null = null
installHealthPlatformMock(() => (sqlite ? sqliteD1(sqlite) : null))

const { createDispatcher } = await import('./index')
const { alertStateKey, alertStateStore } = await import(
  '../../alert-state-store'
)
const { ErrorLogger } = await import('@chm/logger')
const { computeSlackSignature } = await import(
  '../../../slack/verify-signature'
)
const { ACK_ACTION_ID } = await import('../../../slack/blocks')
const { __handlePostForTests: handleInteraction } = await import(
  '../../../../routes/api/v1/slack/interactions'
)

const MIGRATIONS = [
  '0010_alert_events.sql',
  '0027_alert_digest.sql',
  '0039_alert_thread_roots.sql',
].map((name) =>
  readFileSync(
    fileURLToPath(
      new URL(
        `../../../../db/conversations-migrations/${name}`,
        import.meta.url
      )
    ),
    'utf8'
  )
)

const ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_ALERT_CHANNEL_ID',
  'SLACK_BOT_NAME',
  'SLACK_BOT_ICON_EMOJI',
  'HEALTH_ALERT_INSTANCE_NAME',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
]

interface Call {
  url: string
  auth: string | null
  body: Record<string, unknown>
  /** The ts Slack answered a chat.postMessage with. */
  ts?: string
}

const realFetch = globalThis.fetch
let savedEnv: Record<string, string | undefined> = {}
let calls: Call[] = []
let nextTs = 1
/** Awaited inside every reactions.* call, to observe reactions in flight. */
let onReaction: (() => Promise<void>) | null = null
/** The Slack `error` a Web API call answers with, or undefined for ok. */
let slackError: (
  method: string,
  body: Record<string, unknown>
) => string | undefined = () => undefined

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.SLACK_BOT_TOKEN = ENV_TOKEN
  process.env.SLACK_ALERT_CHANNEL_ID = ENV_CHANNEL
  installed = false
  calls = []
  nextTs = 1
  slackError = () => undefined
  onReaction = null
  alertStateStore.clear()
  sqlite = new Database(':memory:')
  for (const sql of MIGRATIONS) sqlite.run(sql)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const raw = String(init?.body ?? '')
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw)
    } catch {
      body = { raw }
    }
    const call: Call = {
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body,
    }
    calls.push(call)
    if (!url.startsWith(SLACK_API)) return new Response('ok', { status: 200 })
    const method = url.slice(SLACK_API.length)
    const error = slackError(method, body)
    if (method.startsWith('reactions.') && onReaction) await onReaction()
    if (error) return Response.json({ ok: false, error })
    if (method === 'chat.postMessage') {
      call.ts = `${nextTs++}.0001`
      return Response.json({ ok: true, ts: call.ts })
    }
    if (method === 'chat.update')
      return Response.json({ ok: true, ts: body.ts })
    return Response.json({ ok: true })
  }) as typeof fetch
})

afterEach(() => {
  setSystemTime()
  globalThis.fetch = realFetch
  sqlite = null
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function route(slackChannelId: string | null): AlertRoute & {
  source: 'file'
} {
  return {
    id: 'slack',
    ownerId: '',
    matchRule: '*',
    matchHost: '*',
    channelUrl: HOOK,
    enabled: true,
    createdAt: 0,
    provider: 'webhook',
    serviceName: null,
    routingKey: null,
    telegramBotToken: null,
    telegramChatId: null,
    ntfyUrl: null,
    ntfyToken: null,
    pushoverToken: null,
    pushoverUser: null,
    matrixHomeserverUrl: null,
    matrixAccessToken: null,
    matrixRoomId: null,
    slackChannelId,
    minSeverity: null,
    source: 'file',
  }
}

function makeCtx(
  routes: AlertRoute[] = [],
  options: { digestWindowMs?: number; webhookUrl?: string } = {}
): SweepContext {
  return {
    settings: {
      webhookUrl: '',
      webhookEnabled: false,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes,
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: options.webhookUrl ?? '',
      webhookUrlTrusted: true,
      healthchecksUrl: '',
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: null,
      pushover: null,
      matrix: null,
      twilio: null,
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: 1, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    repeatBackoffMaxMs: null,
    mutedRules: [],
    enabledRules: [],
    notifyRules: [],
    rules: [],
    thresholdOverrides: {} as SweepContext['thresholdOverrides'],
    hysteresis: {
      defaults: { minConsecutiveBreaches: 1, minConsecutiveClears: 1 },
      byRule: {},
    },
    orderedCompoundRules: [],
    configs: [],
    windows: [],
    quietHours: [],
    digestWindowMs: options.digestWindowMs ?? 0,
    acks: [],
  } as SweepContext
}

type Sev = 'warning' | 'critical' | 'ok'

/** One sweep with one finding per host; returns the requests it made. */
async function tick(
  ctx: SweepContext,
  severity: Sev,
  value = 99,
  hostIds: number[] = [1]
) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  const dispatcher = await createDispatcher(ctx)
  for (const hostId of hostIds) {
    await dispatcher.dispatchFinding({
      hostId,
      hostName: `ch-${hostId}`,
      ruleId: 'slack-test',
      ruleType: 'threshold',
      ruleTitle: 'Slack test',
      severity,
      value,
      label: 'too high',
      warnThreshold: 80,
      critThreshold: 90,
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  await dispatcher.flushSlackReactions()
  return takeCalls()
}

function takeCalls(): Call[] {
  const out = calls
  calls = []
  return out
}

/** A request as one short line, so an ordered list reads as the story. */
function line(c: Call): string {
  if (!c.url.startsWith(SLACK_API)) return `webhook ${c.url}`
  const method = c.url.slice(SLACK_API.length)
  const b = c.body
  switch (method) {
    case 'chat.postMessage':
      return b.thread_ts
        ? `post ${b.channel} in ${b.thread_ts}`
        : `post ${b.channel}`
    case 'chat.update':
      return `update ${b.channel} ${b.ts}`
    case 'reactions.add':
      return `react+ ${b.name} ${b.timestamp}`
    case 'reactions.remove':
      return `react- ${b.name} ${b.timestamp}`
    default:
      return method
  }
}

const lines = (out: Call[]) => out.map(line)

/** The calls that post or edit messages, without reactions. */
const posts = (out: Call[]) => lines(out).filter((l) => !l.startsWith('react'))

/** The mrkdwn text a call posted, flattened. */
const textOf = (c: Call) => JSON.stringify(c.body.blocks ?? c.body.text ?? '')

/** The native charts a call posted, as title, x axis and values per line. */
function chartsIn(c: Call) {
  const blocks = (c.body.blocks ?? []) as {
    type: string
    title?: string
    chart?: {
      series: { name: string; data: { value: number }[] }[]
      axis_config: { categories: string[] }
    }
  }[]
  return blocks.flatMap((b) =>
    b.type === 'data_visualization' && b.chart
      ? [
          {
            title: b.title,
            categories: b.chart.axis_config.categories,
            series: Object.fromEntries(
              b.chart.series.map((s) => [s.name, s.data.map((p) => p.value)])
            ),
          },
        ]
      : []
  )
}

const rootRows = () =>
  sqlite
    ?.query(
      'SELECT host_id, rule_id, root_id FROM alert_thread_roots ORDER BY host_id'
    )
    .all() ?? []

const historyRows = () =>
  sqlite
    ?.query(
      'SELECT decision_kind, delivered, error, channel FROM alert_events ORDER BY event_time'
    )
    .all() ?? []

const SIGNING_SECRET = 'lifecycle-signing-secret'

/** Configure the Slack app, so alerts carry an Acknowledge button. */
function configureSlackApp() {
  process.env.SLACK_CLIENT_ID = 'client-id'
  process.env.SLACK_CLIENT_SECRET = 'client-secret'
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET
}

/** Click the Acknowledge button on a posted message, as Slack would send it. */
async function clickAck(message: Call): Promise<Call[]> {
  const blocks = (message.body.blocks ?? []) as {
    type: string
    elements?: { action_id?: string; value?: string }[]
  }[]
  const button = blocks
    .flatMap((b) => b.elements ?? [])
    .find((e) => e.action_id === ACK_ACTION_ID)
  if (!button) throw new Error('the message has no Acknowledge button')
  const raw = new URLSearchParams({
    payload: JSON.stringify({
      type: 'block_actions',
      user: { id: 'U0ALICE', name: 'alice' },
      team: { id: TEAM },
      channel: { id: message.body.channel },
      container: {
        type: 'message',
        message_ts: message.ts,
        channel_id: message.body.channel,
      },
      message: { ts: message.ts, blocks },
      actions: [{ action_id: ACK_ACTION_ID, value: button.value }],
    }),
  }).toString()
  const ts = String(Math.floor(Date.now() / 1000))
  const res = await handleInteraction(
    new Request('https://dash.example.dev/api/v1/slack/interactions', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': await computeSlackSignature(
          SIGNING_SECRET,
          ts,
          raw
        ),
        'x-slack-request-timestamp': ts,
      },
      body: raw,
    })
  )
  expect(res.status).toBe(200)
  return takeCalls()
}

/** Warnings logged while `fn` runs. */
async function captureWarnings(fn: () => Promise<unknown>): Promise<string> {
  const logged: unknown[] = []
  const spy = spyOn(ErrorLogger, 'logWarning').mockImplementation(
    (...args: unknown[]) => {
      logged.push(...args)
    }
  )
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return JSON.stringify(logged)
}

describe('Slack bot channel with no webhook URL', () => {
  test('an alert no route matched posts through the env bot to SLACK_ALERT_CHANNEL_ID', async () => {
    const out = await tick(makeCtx(), 'critical')
    expect(posts(out)).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect([...new Set(out.map((c) => c.auth))]).toEqual([
      `Bearer ${ENV_TOKEN}`,
    ])
  })

  test('without SLACK_BOT_TOKEN the channel id alone sends nothing', async () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(posts(await tick(makeCtx(), 'critical'))).toEqual([])
  })

  test('the standing message is keyed by the channel, not the token: a rotated token edits it', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    process.env.SLACK_BOT_TOKEN = 'xoxb-rotated-secret-token'
    const out = await tick(ctx, 'ok')
    expect(posts(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(out[0].auth).toBe('Bearer xoxb-rotated-secret-token')
    expect(rootRows()).toEqual([])
  })

  test('a failed post with no webhook sends nothing else, records the failure, and retries next sweep', async () => {
    const ctx = makeCtx()
    slackError = (method) =>
      method === 'chat.postMessage' ? 'not_in_channel' : undefined
    expect(posts(await tick(ctx, 'critical'))).toEqual([`post ${ENV_CHANNEL}`])
    expect(historyRows()).toEqual([
      {
        decision_kind: 'new',
        delivered: 0,
        error: 'not_in_channel',
        channel: 'slack',
      },
    ])
    slackError = () => undefined
    expect(posts(await tick(ctx, 'critical'))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })

  test('a rate-limited edit keeps the standing message and the recovery retries next sweep', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    slackError = (method) =>
      method === 'chat.update' ? 'ratelimited' : undefined
    expect(lines(await tick(ctx, 'ok', 10))).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
    ])
    expect(rootRows()).toEqual([
      { host_id: -1, rule_id: 'digest', root_id: '1.0001' },
      { host_id: 1, rule_id: 'slack-test', root_id: '2.0001' },
    ])
    slackError = () => undefined
    expect(posts(await tick(ctx, 'ok', 10))).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })

  test("a route's own channel id wins over SLACK_ALERT_CHANNEL_ID", async () => {
    const out = await tick(makeCtx([route(ROUTE_CHANNEL)]), 'critical')
    expect(posts(out)).toEqual([
      `post ${ROUTE_CHANNEL}`,
      `post ${ROUTE_CHANNEL} in 1.0001`,
    ])
  })

  test('a matched route suppresses the env channel, like the legacy webhook', async () => {
    const out = await tick(makeCtx([route(null)]), 'critical')
    expect(posts(out)).toEqual([`webhook ${HOOK}`])
  })

  test('with no metadata DB the recovery still reaches the channel and commits', async () => {
    sqlite = null
    const ctx = makeCtx()
    expect(posts(await tick(ctx, 'critical'))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    const recovery = await tick(ctx, 'ok')
    expect(posts(recovery)).toEqual([`post ${ENV_CHANNEL}`])
    expect(textOf(recovery[0])).toContain('resolved')
    expect(posts(await tick(ctx, 'ok'))).toEqual([])
  })

  test('a failed post of an alert the time window holds elsewhere is parked and sent exactly once next sweep', async () => {
    const ctx = makeCtx([], {
      digestWindowMs: 60_000,
      webhookUrl: 'https://example.com/hook',
    })
    slackError = (method) =>
      method === 'chat.postMessage' ? 'not_in_channel' : undefined
    expect(posts(await tick(ctx, 'warning', 85))).toEqual([
      `post ${ENV_CHANNEL}`,
    ])
    slackError = () => undefined
    expect(posts(await tick(ctx, 'warning', 85))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(posts(await tick(ctx, 'warning', 85))).toEqual([])
  })

  test('a Slack catch-all webhook next to SLACK_ALERT_CHANNEL_ID still gets the alert, with one warning', async () => {
    const generic = await captureWarnings(() =>
      tick(makeCtx([], { webhookUrl: 'https://example.com/hook' }), 'critical')
    )
    expect(generic).not.toContain('SLACK_ALERT_CHANNEL_ID')
    let first: Call[] = []
    const slack = await captureWarnings(async () => {
      first = await tick(makeCtx([], { webhookUrl: HOOK }), 'critical', 99, [2])
      await tick(makeCtx([], { webhookUrl: HOOK }), 'critical', 99, [3])
    })
    expect(posts(first)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      `webhook ${HOOK}`,
    ])
    expect(slack.match(/SLACK_ALERT_CHANNEL_ID/g)).toEqual([
      'SLACK_ALERT_CHANNEL_ID',
    ])
  })

  test('the digest time window never holds a bot alert', async () => {
    const out = await tick(makeCtx([], { digestWindowMs: 60_000 }), 'warning')
    expect(posts(out)).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })
})

describe('the episode details message', () => {
  const standing = (rootId: string) => ({
    host_id: -1,
    rule_id: 'digest',
    root_id: rootId,
  })
  const detail = (hostId: number, rootId: string) => ({
    host_id: hostId,
    rule_id: 'slack-test',
    root_id: rootId,
  })

  test('a lone alert stores its details reply apart from the standing message', async () => {
    await tick(makeCtx(), 'critical')
    expect(rootRows()).toEqual([standing('1.0001'), detail(1, '2.0001')])
  })

  test('an escalation keeps the first details message', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'warning', 85)
    const out = await tick(ctx, 'critical', 97)
    expect(posts(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(rootRows()).toEqual([standing('1.0001'), detail(1, '2.0001')])
  })

  test('the recovery drops it only after the reply that closes it went out', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    let rowsAtReply: unknown[] = []
    slackError = (method, body) => {
      if (method === 'chat.postMessage' && body.thread_ts) {
        rowsAtReply = rootRows()
      }
      return undefined
    }
    await tick(ctx, 'ok')
    expect(rowsAtReply).toEqual([standing('1.0001'), detail(1, '2.0001')])
    expect(rootRows()).toEqual([])
  })

  test('a new alert of a rule already open on another host gets its own details message', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical', 99, [1])
    const out = await tick(ctx, 'critical', 99, [1, 2])
    expect(posts(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(textOf(out[1])).toContain('ch-2')
    expect(rootRows()).toEqual([
      standing('1.0001'),
      detail(1, '2.0001'),
      detail(2, '3.0001'),
    ])
  })

  test('a recovery whose closing reply failed keeps its details message', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    slackError = (method, body) =>
      method === 'chat.postMessage' && body.thread_ts
        ? 'ratelimited'
        : undefined
    await tick(ctx, 'ok', 10)
    expect(rootRows()).toEqual([detail(1, '2.0001')])
  })

  test('alerts that share one digest reply store no details message', async () => {
    await tick(makeCtx(), 'critical', 99, [1, 2])
    expect(rootRows()).toEqual([standing('1.0001')])
  })
})

describe('reactions as alert state', () => {
  test('a new alert marks its details message with its severity', async () => {
    expect(lines(await tick(makeCtx(), 'warning', 85))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ large_orange_circle 2.0001',
    ])
  })

  test('an escalation swaps the reaction on the first details message', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'warning', 85)
    expect(lines(await tick(ctx, 'critical', 97))).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ red_circle 2.0001',
      'react- large_orange_circle 2.0001',
    ])
  })

  for (const [severity, reaction] of [
    ['critical', 'red_circle'],
    ['warning', 'large_orange_circle'],
  ] as const) {
    test(`a ${severity} recovery marks it resolved and removes only ${reaction}`, async () => {
      const ctx = makeCtx()
      await tick(ctx, severity, 85)
      expect(lines(await tick(ctx, 'ok', 10))).toEqual([
        `update ${ENV_CHANNEL} 1.0001`,
        `post ${ENV_CHANNEL} in 1.0001`,
        'react+ white_check_mark 2.0001',
        `react- ${reaction} 2.0001`,
      ])
    })
  }

  test('reactions go out after the delivery is recorded and committed', async () => {
    let historyAtReaction: unknown[] = []
    let stateAtReaction: string | undefined
    slackError = (method) => {
      if (method === 'reactions.add') {
        historyAtReaction = historyRows()
        stateAtReaction = alertStateStore.get(
          alertStateKey(1, 'slack-test')
        )?.severity
      }
      return undefined
    }
    await tick(makeCtx(), 'critical')
    expect(historyAtReaction).toEqual([
      { decision_kind: 'new', delivered: 1, error: null, channel: 'slack' },
    ])
    expect(stateAtReaction).toBe('critical')
  })

  test('a sweep sets at most 4 reactions at once', async () => {
    const hostIds = [1, 2, 3, 4, 5, 6]
    const ctx = makeCtx()
    for (const hostId of hostIds) await tick(ctx, 'critical', 99, [hostId])
    let inFlight = 0
    let most = 0
    onReaction = async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
    }
    const out = await tick(ctx, 'ok', 10, hostIds)
    expect(most).toBe(4)
    expect(
      lines(out)
        .filter((l) => l.startsWith('react'))
        .sort()
    ).toEqual(
      hostIds
        .flatMap((h) => [
          `react+ white_check_mark ${h + 1}.0001`,
          `react- red_circle ${h + 1}.0001`,
        ])
        .sort()
    )
  })

  test('an episode with no stored details message gets no reaction', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    sqlite?.run('DELETE FROM alert_thread_roots WHERE host_id = 1')
    expect(lines(await tick(ctx, 'ok', 10))).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })

  test('an Acknowledge click adds eyes to the clicked message', async () => {
    configureSlackApp()
    const [, details] = await tick(makeCtx(), 'critical')
    const out = await clickAck(details)
    expect(lines(out)).toEqual(['react+ eyes 2.0001'])
    expect(out[0].body.channel).toBe(ENV_CHANNEL)
    expect(out[0].auth).toBe(`Bearer ${ENV_TOKEN}`)
  })

  test("a slow reaction never holds the click's response past Slack's 3 s", async () => {
    configureSlackApp()
    const [, details] = await tick(makeCtx(), 'critical')
    onReaction = () => new Promise(() => {})
    const started = Date.now()
    await clickAck(details)
    expect(Date.now() - started).toBeLessThan(2_900)
  })

  test('a token without reactions:write still delivers, silently, and is not sent again', async () => {
    const ctx = makeCtx()
    slackError = (method) =>
      method.startsWith('reactions.') ? 'missing_scope' : undefined
    let out: Call[] = []
    const warnings = await captureWarnings(async () => {
      out = await tick(ctx, 'critical')
    })
    expect(lines(out)).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ red_circle 2.0001',
    ])
    expect(warnings).not.toContain('reaction')
    expect(historyRows()).toEqual([
      { decision_kind: 'new', delivered: 1, error: null, channel: 'slack' },
    ])
    expect(lines(await tick(ctx, 'critical'))).toEqual([])
  })

  test('a failed reaction is logged by its code and never fails or re-sends the alert', async () => {
    const ctx = makeCtx()
    slackError = (method) =>
      method === 'reactions.add' ? 'ratelimited' : undefined
    const warnings = await captureWarnings(() => tick(ctx, 'critical'))
    expect(warnings).toContain('ratelimited')
    expect(warnings).not.toContain(ENV_TOKEN)
    expect(historyRows()).toEqual([
      { decision_kind: 'new', delivered: 1, error: null, channel: 'slack' },
    ])
    expect(lines(await tick(ctx, 'critical'))).toEqual([])
  })
})

describe('the resolved reply', () => {
  test('quotes the alert it closes in the standing thread, then reacts', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'warning', 85)
    await tick(ctx, 'critical', 97)
    const out = await tick(ctx, 'ok', 10)
    expect(lines(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ white_check_mark 2.0001',
      'react- red_circle 2.0001',
    ])
    const text = textOf(out[1])
    expect(text).toContain('🟢 *RESOLVED*  Slack test · ch-1 · resolved after')
    expect(text).toContain('peak 97 · last 10')
    expect(text).toContain('> 🟠 *WARNING*  Slack test · ch-1 · 85 · fired ')
  })

  test('an older episode with no stored details message still gets the quote, with no reaction', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical', 97)
    sqlite?.run('DELETE FROM alert_thread_roots WHERE host_id = 1')
    const out = await tick(ctx, 'ok', 10)
    expect(lines(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(textOf(out[1])).toContain('> 🔴 *CRITICAL*  Slack test · ch-1 · 97')
  })

  test('without alert history the reply says RESOLVED with no quote', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical', 97)
    sqlite?.run('DROP TABLE alert_events')
    const out = await tick(ctx, 'ok', 10)
    expect(posts(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    const text = textOf(out[1])
    expect(text).toContain('🟢 *RESOLVED*  Slack test · ch-1')
    expect(text).not.toContain('fired ')
  })
})

const BARS = /[▁▂▃▄▅▆▇█]/

describe('the trend line', () => {
  test('an escalation draws the episode so far in its details reply', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'warning', 85)
    const [, details] = await tick(ctx, 'critical', 97)
    expect(textOf(details)).toContain('`▁█ 85 → 97 (warn 80, crit 90)`')
  })

  /**
   * Warning at 85, critical at 97, back to warning at 86 (which sends and
   * records nothing), each five minutes apart from 09:00 UTC. The clock is
   * left at 09:15 for the next tick, the second escalation.
   */
  async function episodeWithHistory(ctx: SweepContext): Promise<void> {
    const sweeps: [string, Sev, number][] = [
      ['09:00', 'warning', 85],
      ['09:05', 'critical', 97],
      ['09:10', 'warning', 86],
    ]
    for (const [hhmm, severity, value] of sweeps) {
      setSystemTime(new Date(`2026-11-16T${hhmm}:00.000Z`))
      await tick(ctx, severity, value)
    }
    setSystemTime(new Date('2026-11-16T09:15:00.000Z'))
  }

  const CHART = {
    title: 'Slack test',
    categories: ['09:00', '09:05', '09:15'],
    series: {
      'slack-test': [85, 97, 99],
      warn: [80, 80, 80],
      crit: [90, 90, 90],
    },
  }

  /** The block types a call posted. */
  const blockTypes = (c: Call) =>
    ((c.body.blocks ?? []) as { type: string }[]).map((b) => b.type)

  test('from three recorded values on, the details reply carries a native line chart', async () => {
    const ctx = makeCtx()
    await episodeWithHistory(ctx)
    const out = await tick(ctx, 'critical', 99)
    expect(lines(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ red_circle 2.0001',
      'react- large_orange_circle 2.0001',
    ])
    expect(chartsIn(out[1])).toEqual([CHART])
    expect(blockTypes(out[1])).toEqual([
      'section',
      'data_visualization',
      'context',
    ])
    expect(textOf(out[1])).not.toMatch(BARS)
  })

  test('when Slack rejects the chart block, the details go out once more as text', async () => {
    const ctx = makeCtx()
    await episodeWithHistory(ctx)
    slackError = (method, body) =>
      method === 'chat.postMessage' &&
      JSON.stringify(body.blocks ?? []).includes('data_visualization')
        ? 'invalid_blocks'
        : undefined
    let out: Call[] = []
    const warnings = await captureWarnings(async () => {
      out = await tick(ctx, 'critical', 99)
    })
    expect(lines(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
      'react+ red_circle 2.0001',
      'react- large_orange_circle 2.0001',
    ])
    expect(chartsIn(out[1])).toEqual([CHART])
    expect(out[1].ts).toBeUndefined()
    expect(blockTypes(out[2])).toEqual(['section', 'context'])
    expect(textOf(out[2])).toContain('`▁▇█ 85 → 99 (warn 80, crit 90)`')
    expect(out[2].ts).toBe('4.0001')
    expect(warnings).toContain('invalid_blocks')
    expect(historyRows().slice(-1)).toEqual([
      {
        decision_kind: 'escalated',
        delivered: 1,
        error: null,
        channel: 'slack',
      },
    ])
    expect(lines(await tick(ctx, 'critical', 99))).toEqual([])
  })

  test('any other error on the chart reply is not retried', async () => {
    const ctx = makeCtx()
    await episodeWithHistory(ctx)
    slackError = (method, body) =>
      method === 'chat.postMessage' && body.thread_ts
        ? 'ratelimited'
        : undefined
    expect(posts(await tick(ctx, 'critical', 99))).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })

  test('a new alert has no history yet, so no trend', async () => {
    const [, details] = await tick(makeCtx(), 'critical', 97)
    expect(textOf(details)).toContain('Slack test')
    expect(textOf(details)).not.toMatch(BARS)
  })

  test('without alert history the escalation still posts its details, with no trend', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'warning', 85)
    sqlite?.run('DROP TABLE alert_events')
    const out = await tick(ctx, 'critical', 97)
    expect(posts(out)).toEqual([
      `update ${ENV_CHANNEL} 1.0001`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(textOf(out[1])).toContain('Slack test')
    expect(textOf(out[1])).not.toMatch(BARS)
  })
})

const LIFECYCLE_TARGETS = [
  {
    name: 'SLACK_BOT_TOKEN with SLACK_ALERT_CHANNEL_ID and no webhook',
    channel: ENV_CHANNEL,
    token: ENV_TOKEN,
    ctx: () => makeCtx(),
  },
  {
    name: 'a webhook route with a channel id and the OAuth install',
    channel: ROUTE_CHANNEL,
    token: INSTALL_TOKEN,
    ctx: () => {
      delete process.env.SLACK_BOT_TOKEN
      installed = true
      return makeCtx([route(ROUTE_CHANNEL)])
    },
  },
]

describe('the whole thread lifecycle', () => {
  for (const target of LIFECYCLE_TARGETS) {
    test(`new, reminder, escalation, ack, recovery: ${target.name}`, async () => {
      configureSlackApp()
      const ctx = target.ctx()
      const ch = target.channel

      const fired = await tick(ctx, 'warning', 85)
      expect(lines(fired)).toEqual([
        `post ${ch}`,
        `post ${ch} in 1.0001`,
        'react+ large_orange_circle 2.0001',
      ])
      expect(JSON.stringify(fired[0].body)).toContain('*1 open* · 1 warning')

      const notifiedAt = () =>
        alertStateStore.get(alertStateKey(1, 'slack-test'))?.notifiedAt
      const beforeReminder = notifiedAt()
      expect(lines(await tick(ctx, 'warning', 86))).toEqual([])
      expect(notifiedAt()).toBeGreaterThan(beforeReminder ?? Infinity)

      const escalated = await tick(ctx, 'critical', 97)
      expect(lines(escalated)).toEqual([
        `update ${ch} 1.0001`,
        `post ${ch} in 1.0001`,
        'react+ red_circle 2.0001',
        'react- large_orange_circle 2.0001',
      ])
      expect(textOf(escalated[1])).toContain('`▁█ 85 → 97 (warn 80, crit 90)`')

      expect(lines(await clickAck(fired[1]))).toEqual(['react+ eyes 2.0001'])

      const resolved = await tick(ctx, 'ok', 10)
      expect(lines(resolved)).toEqual([
        `update ${ch} 1.0001`,
        `post ${ch} in 1.0001`,
        'react+ white_check_mark 2.0001',
        'react- red_circle 2.0001',
      ])
      expect(JSON.stringify(resolved[0].body)).toContain('All clear')
      const quote = textOf(resolved[1])
      expect(quote).toContain('peak 97 · last 10')
      expect(quote).toContain('> 🟠 *WARNING*  Slack test · ch-1 · 85 · fired ')

      const slackCalls = [...fired, ...escalated, ...resolved]
      expect(new Set(slackCalls.map((c) => c.auth))).toEqual(
        new Set([`Bearer ${target.token}`])
      )
      expect(rootRows()).toEqual([])
    })
  }
})
