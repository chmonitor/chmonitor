/**
 * Slack bot delivery on a webhook route with a channel id (#4241): a firing
 * alert posts one compact parent line plus one thread reply with details; a
 * repeat edits the same parent; recovery edits it to RESOLVED and replies in
 * the thread, never a new top-level message. Without a channel id, without an
 * installation, or when the Slack API fails, the webhook post is unchanged.
 * Drives the real dispatcher against a real SQLite thread-root table.
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

const realAlertHistoryStore = {
  ...(await import('../../alert-history-store')),
}
mock.module('../../alert-history-store', () => ({
  ...realAlertHistoryStore,
  recordAlertEvent: async () => {},
}))

const BOT_TOKEN = 'xoxb-secret-test-token'
const TEAM = 'T0TEAM'
let installed = true
const realInstallStore = { ...(await import('../../../slack/install-store')) }
mock.module('../../../slack/install-store', () => ({
  ...realInstallStore,
  getInstallation: async (teamId: string) =>
    installed && teamId === TEAM
      ? {
          teamId,
          botToken: BOT_TOKEN,
          ownerRef: '',
          installedAt: 0,
          updatedAt: 0,
        }
      : null,
}))

afterAll(() => {
  mock.module('../../alert-history-store', () => ({ ...realAlertHistoryStore }))
  mock.module('../../../slack/install-store', () => ({ ...realInstallStore }))
})

function sqliteD1(db: Database) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const params = args as (string | number)[]
          return {
            async all() {
              return {
                results: db.query(sql).all(...params),
                success: true,
                meta: {},
              }
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

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../db/conversations-migrations/0039_alert_thread_roots.sql',
      import.meta.url
    )
  ),
  'utf8'
)

const HOOK = `https://hooks.slack.com/services/${TEAM}/B0HOOK/xyz`
const CHANNEL = 'C0ALERTS'

interface Sent {
  url: string
  auth: string | null
  body: Record<string, unknown>
}
const realFetch = globalThis.fetch
let sent: Sent[] = []
let nextTs = 1
/** Slack Web API methods that answer `ok: false`. */
let failing = new Set<string>()

beforeEach(() => {
  sent = []
  nextTs = 1
  failing = new Set()
  installed = true
  alertStateStore.clear()
  sqlite = new Database(':memory:')
  sqlite.run(MIGRATION)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    sent.push({
      url,
      auth: headers.get('authorization'),
      body: JSON.parse(String(init?.body)),
    })
    if (url.startsWith('https://slack.com/api/')) {
      const method = url.slice('https://slack.com/api/'.length)
      if (failing.has(method)) {
        return Response.json({ ok: false, error: 'channel_not_found' })
      }
      return Response.json({ ok: true, ts: `${nextTs++}.0001` })
    }
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  sqlite = null
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

function makeCtx(slackChannelId: string | null): SweepContext {
  return {
    settings: {
      webhookUrl: '',
      webhookEnabled: false,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [route(slackChannelId)],
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
    digestWindowMs: 0,
    acks: [],
  } as SweepContext
}

type Sev = 'warning' | 'critical' | 'ok'

async function tick(
  ctx: SweepContext,
  severity: Sev | ((hostId: number) => Sev),
  hostIds: number[] = [1]
) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  const dispatcher = await createDispatcher(ctx)
  for (const hostId of hostIds) {
    const sev = typeof severity === 'function' ? severity(hostId) : severity
    await dispatcher.dispatchFinding({
      hostId,
      hostName: `ch-${hostId}`,
      ruleId: 'slack-test',
      ruleType: 'threshold',
      ruleTitle: 'Slack test',
      severity: sev,
      value: sev === 'ok' ? 1 : 99,
      label: 'too high',
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  const out = sent
  sent = []
  return out
}

const method = (s: Sent) => s.url.replace('https://slack.com/api/', '')
const parentText = (s: Sent) =>
  (
    s.body.attachments as { blocks: { text: { text: string } }[] }[]
  )[0].blocks[0].text.text.toString()
const rootRows = () =>
  sqlite?.query('SELECT root_id FROM alert_thread_roots').all() ?? []
const threadTs = (s: Sent) => s.body.thread_ts

describe('Slack bot standing digest (#4246)', () => {
  test('several findings post one standing parent and one threaded change', async () => {
    const out = await tick(makeCtx(CHANNEL), 'critical', [1, 2])
    expect(out.map(method)).toEqual(['chat.postMessage', 'chat.postMessage'])
    const [parent, change] = out
    expect(parent.body.channel).toBe(CHANNEL)
    expect(parent.auth).toBe(`Bearer ${BOT_TOKEN}`)
    expect(parent.body.text).toBeUndefined()
    expect(threadTs(parent)).toBeUndefined()
    expect(parentText(parent)).toContain('2 critical')
    expect(threadTs(change)).toBe('1.0001')
    expect(
      sqlite
        ?.query('SELECT root_id, host_id, rule_id FROM alert_thread_roots')
        .all()
    ).toEqual([{ root_id: '1.0001', host_id: -1, rule_id: 'digest' }])
  })

  test('a lone finding also lands in the standing message, with details in the thread', async () => {
    const out = await tick(makeCtx(CHANNEL), 'critical')
    expect(out.map(method)).toEqual(['chat.postMessage', 'chat.postMessage'])
    expect(parentText(out[0])).toContain('1 critical')
    expect(threadTs(out[1])).toBe('1.0001')
    expect(JSON.stringify(out[1].body.blocks)).toContain('*Host:*')
  })

  test('a later change edits the same message and replies in its thread', async () => {
    const ctx = makeCtx(CHANNEL)
    await tick(ctx, 'critical', [1, 2])
    const out = await tick(ctx, (h) => (h === 1 ? 'ok' : 'critical'), [1, 2])
    expect(out.map(method)).toEqual(['chat.update', 'chat.postMessage'])
    expect(out[0].body.ts).toBe('1.0001')
    expect(parentText(out[0])).toContain('1 critical')
    expect(threadTs(out[1])).toBe('1.0001')
    expect(out.some((s) => s.url === HOOK)).toBe(false)
    expect(rootRows()).toEqual([{ root_id: '1.0001' }])
  })

  test('the last recovery resolves the message and clears the root', async () => {
    const ctx = makeCtx(CHANNEL)
    await tick(ctx, 'critical')
    const out = await tick(ctx, 'ok')
    expect(out.map(method)).toEqual(['chat.update', 'chat.postMessage'])
    expect(out[0].body.ts).toBe('1.0001')
    expect(parentText(out[0])).toContain('✅')
    expect(threadTs(out[1])).toBe('1.0001')
    expect(out.some((s) => s.url === HOOK)).toBe(false)
    expect(rootRows()).toEqual([])
    // The next incident starts a fresh standing message.
    const next = await tick(ctx, 'critical')
    expect(next.map(method)).toEqual(['chat.postMessage', 'chat.postMessage'])
    expect(threadTs(next[0])).toBeUndefined()
  })

  test('a deleted standing message is replaced by a new one and the root follows', async () => {
    const ctx = makeCtx(CHANNEL)
    await tick(ctx, 'critical', [1, 2])
    failing.add('chat.update')
    const out = await tick(ctx, (h) => (h === 1 ? 'ok' : 'critical'), [1, 2])
    expect(out.map(method)).toEqual([
      'chat.update',
      'chat.postMessage',
      'chat.postMessage',
    ])
    expect(threadTs(out[1])).toBeUndefined()
    expect(rootRows()).toEqual([{ root_id: '3.0001' }])
    expect(threadTs(out[2])).toBe('3.0001')
  })

  test('without a channel id the webhook post is unchanged', async () => {
    const out = await tick(makeCtx(null), 'critical')
    expect(out.map((s) => s.url)).toEqual([HOOK])
  })

  test('without an installation for the team the webhook is used', async () => {
    installed = false
    const out = await tick(makeCtx(CHANNEL), 'critical')
    expect(out.map((s) => s.url)).toEqual([HOOK])
  })

  test('a failing chat.postMessage falls back to the webhook', async () => {
    failing.add('chat.postMessage')
    const out = await tick(makeCtx(CHANNEL), 'critical')
    expect(out.map((s) => s.url)).toEqual([
      'https://slack.com/api/chat.postMessage',
      HOOK,
    ])
    expect(rootRows()).toEqual([])
  })

  test('a failing chat.update on recovery falls back to the webhook', async () => {
    const ctx = makeCtx(CHANNEL)
    await tick(ctx, 'critical')
    failing.add('chat.update')
    const out = await tick(ctx, 'ok')
    expect(out.map((s) => s.url)).toEqual([
      'https://slack.com/api/chat.update',
      HOOK,
    ])
  })
})
