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
  }
}

let sqlite: Database | null = null
installHealthPlatformMock(() => (sqlite ? sqliteD1(sqlite) : null))

const { createDispatcher } = await import('./index')
const { alertStateStore } = await import('../../alert-state-store')

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
}

const realFetch = globalThis.fetch
let savedEnv: Record<string, string | undefined> = {}
let calls: Call[] = []
let nextTs = 1
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
    calls.push({
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body,
    })
    if (!url.startsWith(SLACK_API)) return new Response('ok', { status: 200 })
    const method = url.slice(SLACK_API.length)
    const error = slackError(method, body)
    if (error) return Response.json({ ok: false, error })
    if (method === 'chat.postMessage') {
      return Response.json({ ok: true, ts: `${nextTs++}.0001` })
    }
    if (method === 'chat.update')
      return Response.json({ ok: true, ts: body.ts })
    return Response.json({ ok: true })
  }) as typeof fetch
})

afterEach(() => {
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
  options: { digestWindowMs?: number } = {}
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
      webhookUrl: '',
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

/** One sweep with one finding on host 1; returns the requests it made. */
async function tick(ctx: SweepContext, severity: Sev, value = 99) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  const dispatcher = await createDispatcher(ctx)
  await dispatcher.dispatchFinding({
    hostId: 1,
    hostName: 'ch-1',
    ruleId: 'slack-test',
    ruleType: 'threshold',
    ruleTitle: 'Slack test',
    severity,
    value,
    label: 'too high',
    warnThreshold: 80,
    critThreshold: 90,
  })
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
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

/** The mrkdwn text a call posted, flattened. */
const textOf = (c: Call) => JSON.stringify(c.body.blocks ?? c.body.text ?? '')

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

describe('Slack bot channel with no webhook URL', () => {
  test('an alert no route matched posts through the env bot to SLACK_ALERT_CHANNEL_ID', async () => {
    const out = await tick(makeCtx(), 'critical')
    expect(lines(out)).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    expect(out.map((c) => c.auth)).toEqual([
      `Bearer ${ENV_TOKEN}`,
      `Bearer ${ENV_TOKEN}`,
    ])
  })

  test('without SLACK_BOT_TOKEN the channel id alone sends nothing', async () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(lines(await tick(makeCtx(), 'critical'))).toEqual([])
  })

  test('the standing message is keyed by the channel, not the token: a rotated token edits it', async () => {
    const ctx = makeCtx()
    await tick(ctx, 'critical')
    process.env.SLACK_BOT_TOKEN = 'xoxb-rotated-secret-token'
    const out = await tick(ctx, 'ok')
    expect(lines(out)).toEqual([
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
    expect(lines(await tick(ctx, 'critical'))).toEqual([`post ${ENV_CHANNEL}`])
    expect(historyRows()).toEqual([
      {
        decision_kind: 'new',
        delivered: 0,
        error: 'not_in_channel',
        channel: 'slack',
      },
    ])
    slackError = () => undefined
    expect(lines(await tick(ctx, 'critical'))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })

  test("a route's own channel id wins over SLACK_ALERT_CHANNEL_ID", async () => {
    const out = await tick(makeCtx([route(ROUTE_CHANNEL)]), 'critical')
    expect(lines(out)).toEqual([
      `post ${ROUTE_CHANNEL}`,
      `post ${ROUTE_CHANNEL} in 1.0001`,
    ])
  })

  test('a matched route suppresses the env channel, like the legacy webhook', async () => {
    const out = await tick(makeCtx([route(null)]), 'critical')
    expect(lines(out)).toEqual([`webhook ${HOOK}`])
  })

  test('with no metadata DB the recovery still reaches the channel and commits', async () => {
    sqlite = null
    const ctx = makeCtx()
    expect(lines(await tick(ctx, 'critical'))).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
    const recovery = await tick(ctx, 'ok')
    expect(lines(recovery)).toEqual([`post ${ENV_CHANNEL}`])
    expect(textOf(recovery[0])).toContain('resolved')
    expect(lines(await tick(ctx, 'ok'))).toEqual([])
  })

  test('the digest time window never holds a bot alert', async () => {
    const out = await tick(makeCtx([], { digestWindowMs: 60_000 }), 'warning')
    expect(lines(out)).toEqual([
      `post ${ENV_CHANNEL}`,
      `post ${ENV_CHANNEL} in 1.0001`,
    ])
  })
})
