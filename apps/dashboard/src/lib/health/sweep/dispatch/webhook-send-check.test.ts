/**
 * Webhook targets from saved alert routes are re-checked against the SSRF
 * guard at send time, in every send path (inline fan-out, digest flush,
 * long-firing digest). Operator-configured targets (the env/global webhook URL
 * and routing.yaml routes) are trusted and not re-checked. Real dispatcher and
 * real `validateHostUrl` (IP literals, so no DNS); only `globalThis.fetch` is
 * stubbed.
 */

import type { AlertRoute } from '../../alert-routing'
import type { HealthDefinitionSource } from '../../declarative/merge'
import type { SweepContext } from '../resolve-config'

import { alertStateKey, alertStateStore } from '../../alert-state-store'
import { createDispatcher } from './index'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const HOUR = 3_600_000
const GOOD = 'https://93.184.216.34/hook'
const LOOPBACK = 'http://127.0.0.1/hook'
const METADATA = 'http://169.254.169.254/latest/meta-data'
// The Discord adapter matches `//discord.com/api/webhooks/` anywhere in the
// URL, so these land on the inline (non-digest) fan-out path.
const discordShaped = (base: string) => `${base}//discord.com/api/webhooks/1/t`

const realFetch = globalThis.fetch
let fetched: string[] = []
let nextHostId = 940_000

beforeEach(() => {
  fetched = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const [key] of [...alertStateStore.entries()]) {
    if (key.startsWith('-1:')) alertStateStore.delete(key)
  }
})

function route(
  channelUrl: string,
  source?: HealthDefinitionSource
): AlertRoute & { source?: HealthDefinitionSource } {
  return {
    id: `r-${channelUrl}`,
    ownerId: '',
    matchRule: '*',
    matchHost: '*',
    channelUrl,
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
    minSeverity: null,
    ...(source ? { source } : {}),
  }
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
      webhookUrlTrusted: false,
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
    cooldown: { defaultMs: 60 * 60_000, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    repeatBackoffMaxMs: null,
    longFiringDigestMs: null,
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

async function sweep(ctx: SweepContext, hostId = nextHostId++) {
  const d = await createDispatcher(ctx)
  await d.dispatchFinding({
    hostId,
    hostName: 'ch-1',
    ruleId: 'disk-usage',
    ruleType: 'threshold',
    ruleTitle: 'Disk usage',
    severity: 'critical',
    value: 91,
    label: 'disk at 91%',
  })
  await d.flushDigests()
  await d.flushBusEvents()
}

/** An incident open for 30 h whose live alert is still in cooldown. */
function seedOpenAlert(): number {
  const hostId = nextHostId++
  const now = Date.now()
  alertStateStore.set(alertStateKey(hostId, 'disk-usage'), {
    severity: 'critical',
    updatedAt: now - 30 * HOUR,
    notifiedAt: now,
    firstFiredAt: now - 30 * HOUR,
    firstValue: 82.8,
    lastNotifiedValue: 90,
  })
  return hostId
}

describe('saved webhook routes are re-checked at send time', () => {
  test('inline fan-out: internal targets are skipped, a good one still sends', async () => {
    const blocked = [discordShaped(LOOPBACK), discordShaped(METADATA)]
    const good = discordShaped(GOOD)
    await sweep(makeCtx({ routes: [...blocked, good].map((u) => route(u)) }))
    expect(fetched).toEqual([good])
  })

  test('digest flush: internal targets are skipped, a good one still sends', async () => {
    await sweep(
      makeCtx({ routes: [LOOPBACK, METADATA, GOOD].map((u) => route(u)) })
    )
    expect(fetched).toEqual([GOOD])
  })

  test('long-firing digest: internal targets are skipped, a good one still sends', async () => {
    const hostId = seedOpenAlert()
    await sweep(
      makeCtx({
        longFiringDigestMs: 24 * HOUR,
        routes: [LOOPBACK, METADATA, GOOD].map((u) => route(u)),
      }),
      hostId
    )
    expect(fetched).toEqual([GOOD])
  })
})

describe('operator-configured webhook targets are not re-checked', () => {
  test('the env/global webhook URL is trusted', async () => {
    await sweep(
      makeCtx({
        channels: {
          ...makeCtx().channels,
          webhookUrl: LOOPBACK,
          webhookUrlTrusted: true,
        },
      })
    )
    expect(fetched).toEqual([LOOPBACK])
  })

  test('a saved (D1) global webhook URL is re-checked', async () => {
    await sweep(
      makeCtx({
        channels: {
          ...makeCtx().channels,
          webhookUrl: LOOPBACK,
          webhookUrlTrusted: false,
        },
      })
    )
    expect(fetched).toEqual([])
  })

  test('routing.yaml routes are trusted in every path', async () => {
    const yaml = [
      route(LOOPBACK, 'file'),
      route(discordShaped(LOOPBACK), 'env'),
    ]
    await sweep(makeCtx({ routes: yaml }))
    expect([...fetched].sort()).toEqual(
      [LOOPBACK, discordShaped(LOOPBACK)].sort()
    )

    fetched = []
    const hostId = seedOpenAlert()
    await sweep(
      makeCtx({
        longFiringDigestMs: 24 * HOUR,
        routes: [route(LOOPBACK, 'file')],
      }),
      hostId
    )
    expect(fetched).toEqual([LOOPBACK])
  })
})
