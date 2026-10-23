/**
 * Native Matrix rooms group per sweep, like custom Matrix targets (#3869):
 * a sweep where 8 rules fire must post ONE message to the room, not 8. A lone
 * finding keeps the single-alert body. Drives the real dispatcher with a
 * stubbed fetch; only the alert-history store is mocked so each finding's
 * audit row can be counted.
 */

import type { AlertPayload } from '../../adapters'
import type { AlertRoute } from '../../alert-routing'
import type { SweepContext } from '../resolve-config'
import type { DispatchCounters } from './types'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const history: { rule: string; channel: string; delivered: boolean }[] = []
mock.module('../../alert-history-store', () => ({
  recordAlertEvent: async (row: {
    rule: string
    channel: string
    delivered: boolean
  }) => {
    history.push({
      rule: row.rule,
      channel: row.channel,
      delivered: row.delivered,
    })
  },
}))

const { createDispatcher } = await import('./index')
const { createDigestPipeline } = await import('./digest')
const { buildMatrixBody } = await import('../../adapters/matrix')

interface Put {
  url: string
  body: { body: string; formatted_body: string }
}
const realFetch = globalThis.fetch
let puts: Put[] = []
let status = 200
let nextHostId = 930_000

beforeEach(() => {
  puts = []
  history.length = 0
  status = 200
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    puts.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response('{"event_id":"$e"}', { status })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const ENV_ROOM = {
  homeserverUrl: 'https://matrix.example.test',
  accessToken: 'syt_env',
  roomId: '!env:example.test',
}

function makeCtx(overrides: Partial<SweepContext> = {}): SweepContext {
  return {
    settings: {
      webhookUrl: '',
      webhookEnabled: false,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: '',
      healthchecksUrl: '',
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: null,
      pushover: null,
      matrix: ENV_ROOM,
      twilio: null,
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: 60_000, bySeverity: {}, byRule: {} },
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
    ...overrides,
  }
}

function matrixRoute(id: string, homeserverUrl: string): AlertRoute {
  return {
    id,
    ownerId: 'o',
    matchRule: '*',
    matchHost: '*',
    channelUrl: '',
    enabled: true,
    createdAt: 0,
    provider: 'matrix',
    serviceName: null,
    routingKey: null,
    telegramBotToken: null,
    telegramChatId: null,
    ntfyUrl: null,
    ntfyToken: null,
    pushoverToken: null,
    pushoverUser: null,
    matrixHomeserverUrl: homeserverUrl,
    matrixAccessToken: `syt_${id}`,
    matrixRoomId: `!${id}:example.test`,
    minSeverity: null,
  } as AlertRoute
}

/** Fire `count` findings (distinct hosts) in ONE sweep, then flush. */
async function sweep(ctx: SweepContext, count: number) {
  const dispatcher = await createDispatcher(ctx)
  const committedBefore = dispatcher.counters.alertsDispatched
  const hosts: number[] = []
  for (let i = 0; i < count; i++) {
    const hostId = nextHostId++
    hosts.push(hostId)
    await dispatcher.dispatchFinding({
      hostId,
      hostName: `ch-${hostId}`,
      ruleId: 'matrix-digest-test',
      ruleType: 'threshold',
      ruleTitle: 'Matrix digest test',
      severity: 'critical',
      value: 99,
      label: 'too high',
    })
  }
  expect(puts).toEqual([])
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  return { dispatcher, hosts, committedBefore }
}

describe('native Matrix routes group per sweep', () => {
  test('three findings to one room send one PUT listing all three', async () => {
    const { dispatcher, hosts } = await sweep(makeCtx(), 3)
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toContain('/rooms/%21env%3Aexample.test/send/')
    for (const h of hosts) expect(puts[0].body.body).toContain(`ch-${h}`)
    expect(puts[0].body.body).toContain('3 critical on 3 hosts')
    expect(dispatcher.counters.alertsDispatched).toBe(3)
    // One audit row per finding, not one digest row.
    expect(history.filter((r) => r.channel === 'matrix')).toHaveLength(3)
  })

  test('a lone finding sends the single-alert body', async () => {
    const { hosts } = await sweep(makeCtx(), 1)
    expect(puts).toHaveLength(1)
    expect(puts[0].body.body).toContain(`ch-${hosts[0]}`)
    expect(puts[0].body.body).not.toContain('critical on')
  })

  test('two routes each get one digest, with distinct txn ids', async () => {
    const ctx = makeCtx({
      routes: [
        matrixRoute('a', 'https://93.184.216.34'),
        matrixRoute('b', 'https://93.184.216.35'),
      ],
    })
    await sweep(ctx, 3)
    expect(puts).toHaveLength(2)
    expect(puts[0].url).toStartWith('https://93.184.216.34/')
    expect(puts[1].url).toStartWith('https://93.184.216.35/')
    for (const p of puts) expect(p.body.body).toContain('3 critical on 3 hosts')
    expect(history.filter((r) => r.channel === 'matrix')).toHaveLength(6)
  })

  test('a blocked saved route sends nothing and does not commit', async () => {
    const ctx = makeCtx({ routes: [matrixRoute('lan', 'https://127.0.0.1')] })
    const dispatcher = await createDispatcher(ctx)
    const finding = {
      hostId: nextHostId++,
      hostName: 'ch-blocked',
      ruleId: 'matrix-digest-test',
      ruleType: 'threshold',
      ruleTitle: 'Matrix digest test',
      severity: 'critical' as const,
      value: 99,
      label: 'too high',
    }
    await dispatcher.dispatchFinding(finding)
    await dispatcher.dispatchFinding({ ...finding, hostId: nextHostId++ })
    await dispatcher.flushDigests()
    expect(puts).toEqual([])
    expect(dispatcher.counters.alertsDispatched).toBe(0)
    expect(history).toEqual([
      { rule: 'matrix-digest-test', channel: 'matrix', delivered: false },
      { rule: 'matrix-digest-test', channel: 'matrix', delivered: false },
    ])
    // Not committed: the next sweep sees the same finding as new again.
    const again = await createDispatcher(makeCtx())
    await again.dispatchFinding(finding)
    await again.flushDigests()
    expect(puts).toHaveLength(1)
  })

  test('a failed digest PUT leaves its findings uncommitted', async () => {
    status = 500
    const { dispatcher } = await sweep(makeCtx(), 2)
    expect(puts).toHaveLength(1)
    expect(dispatcher.counters.alertsDispatched).toBe(0)
  })

  test('a digest in a later sweep gets a new txn id', async () => {
    await sweep(makeCtx(), 2)
    const first = puts[0].url
    puts = []
    await sweep(makeCtx(), 2)
    const txn = (u: string) => u.slice(u.lastIndexOf('/') + 1)
    expect(txn(first)).toStartWith('chm-')
    expect(txn(first)).not.toBe(txn(puts[0].url))
  })
})

describe('Matrix digest renders recoveries and reminders', () => {
  const counters = (): DispatchCounters => ({
    alertsDispatched: 0,
    alertsSuppressed: 0,
    maintenanceSuppressed: 0,
    quietHoursSuppressed: 0,
    ackedSuppressed: 0,
    mutedSuppressed: 0,
    signalOnlySuppressed: 0,
    recoveries: 0,
    emailsDispatched: 0,
    digestBuffered: 0,
    digestFlushed: 0,
  })

  const base: AlertPayload = {
    severity: 'critical',
    hostLabel: 'h',
    hostId: 0,
    metric: 'disk-usage',
    value: 90,
    title: 'Disk usage',
    label: '90%',
    timestamp: new Date(0).toISOString(),
  }

  async function settle(
    pipeline: Awaited<ReturnType<typeof createDigestPipeline>>,
    payload: AlertPayload,
    kind: 'new' | 'recovery' | 'reminder'
  ) {
    await pipeline.settleFinding({
      finding: {
        hostId: payload.hostId,
        hostLabel: payload.hostLabel,
        ruleId: payload.metric,
        effective: 'critical',
        isRecovery: kind === 'recovery',
        decision: { kind, severity: payload.severity },
        text: payload.label,
      } as never,
      commit: () => {},
      anyDelivered: false,
      groupableWebhookTargets: [],
      findingTelegramTargets: [],
      groupableMatrixTargets: [{ target: ENV_ROOM, trusted: true }],
      immediateTargetCount: 0,
      webhookPayload: payload,
    })
  }

  test('one PUT carries the alert, the recovery and the reminder', async () => {
    const pipeline = await createDigestPipeline(
      { digestWindowMs: 0 } as never,
      counters()
    )
    await settle(pipeline, { ...base, hostId: 1, hostLabel: 'h1' }, 'new')
    await settle(
      pipeline,
      {
        ...base,
        hostId: 2,
        hostLabel: 'h2',
        severity: 'recovery',
        firedForMs: 600_000,
      },
      'recovery'
    )
    await settle(
      pipeline,
      { ...base, hostId: 3, hostLabel: 'h3', stillOpenMs: 5 * 3_600_000 },
      'reminder'
    )
    await pipeline.flushDigests()
    expect(puts).toHaveLength(1)
    const text = puts[0].body.body
    expect(text).toContain('h1 · disk-usage = 90')
    expect(text).toContain(
      'h2 · disk-usage = 90 · RESOLVED — 90%, fired for 10 min'
    )
    expect(text).toContain('h3 · still open')
  })

  test('a lone alert sends exactly buildMatrixBody', async () => {
    const pipeline = await createDigestPipeline(
      { digestWindowMs: 0 } as never,
      counters()
    )
    const p = { ...base, hostId: 4, hostLabel: 'h4' }
    await settle(pipeline, p, 'new')
    await pipeline.flushDigests()
    expect(puts.map((x) => x.body)).toEqual([buildMatrixBody(p) as never])
  })
})
