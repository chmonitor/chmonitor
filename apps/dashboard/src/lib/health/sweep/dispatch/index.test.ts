/**
 * createDispatcher fan-out characterization (#3808). Real dispatcher, real
 * dedup state; only `globalThis.fetch` is stubbed (restored after each test)
 * so no module mocks leak into other files. ntfy and healthchecks are both
 * inline (non-digest) channels, so each finding hits them directly.
 */

import type { SweepContext } from '../resolve-config'

import { createDispatcher } from './index'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const NTFY_URL = 'https://ntfy.example.test/topic'
const HC_URL = 'https://hc.example.test/ping-uuid'

const realFetch = globalThis.fetch
let calls: string[] = []
let responder: (url: string) => Response
let nextHostId = 910_000

beforeEach(() => {
  calls = []
  responder = () => new Response('ok', { status: 200 })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return responder(url)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

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
      healthchecksUrl: HC_URL,
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: { url: NTFY_URL },
      pushover: null,
      twilio: null,
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: 60_000, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    mutedRules: [],
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

async function fire(
  ctx: SweepContext,
  severity: 'warning' | 'critical' = 'critical'
) {
  const dispatcher = await createDispatcher(ctx)
  // Unique host per call: the dedup store is a process-wide singleton.
  await dispatcher.dispatchFinding({
    hostId: nextHostId++,
    hostName: 'ch-1',
    ruleId: 'fanout-test',
    ruleType: 'threshold',
    ruleTitle: 'Fan-out test',
    severity,
    value: 99,
    label: 'too high',
  })
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  return dispatcher
}

describe('createDispatcher fan-out', () => {
  test('delivers one finding to every enabled inline channel', async () => {
    const d = await fire(makeCtx())
    expect([...calls].sort()).toEqual([HC_URL, NTFY_URL].sort())
    expect(d.counters.alertsDispatched).toBe(1)
  })

  test('a failing channel does not block the others', async () => {
    responder = (url) =>
      url === NTFY_URL
        ? new Response('boom', { status: 500 })
        : new Response('ok', { status: 200 })
    const d = await fire(makeCtx())
    // ntfy is dispatched first and fails; healthchecks must still be pinged.
    expect(calls).toContain(NTFY_URL)
    expect(calls).toContain(HC_URL)
    expect(d.counters.alertsDispatched).toBe(1)
  })

  test('a channel that throws does not block the others', async () => {
    responder = (url) => {
      if (url === NTFY_URL) throw new Error('network down')
      return new Response('ok', { status: 200 })
    }
    const d = await fire(makeCtx())
    expect(calls).toContain(HC_URL)
    expect(d.counters.alertsDispatched).toBe(1)
  })

  test('when every channel fails nothing is counted as dispatched', async () => {
    responder = () => new Response('boom', { status: 500 })
    const d = await fire(makeCtx())
    expect([...calls].sort()).toEqual([HC_URL, NTFY_URL].sort())
    expect(d.counters.alertsDispatched).toBe(0)
  })

  test('a disabled channel is not called, the enabled one still is', async () => {
    const d = await fire(
      makeCtx({ channelSettings: { ntfy: { enabled: false } } })
    )
    expect(calls).toEqual([HC_URL])
    expect(d.counters.alertsDispatched).toBe(1)
  })

  test('a channel whose floor is above the finding severity is skipped', async () => {
    await fire(
      makeCtx({ channelSettings: { ntfy: { minSeverity: 'critical' } } }),
      'warning'
    )
    expect(calls).toEqual([HC_URL])
  })
})
/**
 * Hookshot targets group per sweep (#3869): three findings in one tick must
 * reach the room as ONE post. Drives the real dispatcher with a Helm-style env
 * target, so dropping the wiring from `dispatchFinding` makes this fail.
 */
describe('createDispatcher grouped hookshot target', () => {
  const HOOK_URL = 'https://93.184.216.34/hookshot/room'
  const saved = {
    targets: process.env.HEALTH_ALERT_WEBHOOK_TARGETS,
    url: process.env.CHM_TEST_HOOKSHOT_URL,
  }
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  beforeEach(() => {
    process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify([
      { name: 'room', format: 'hookshot', urlEnv: 'CHM_TEST_HOOKSHOT_URL' },
    ])
    process.env.CHM_TEST_HOOKSHOT_URL = HOOK_URL
  })

  afterEach(() => {
    restore('HEALTH_ALERT_WEBHOOK_TARGETS', saved.targets)
    restore('CHM_TEST_HOOKSHOT_URL', saved.url)
  })

  test('three findings in one sweep send one post to the target', async () => {
    const ctx = makeCtx({
      channels: { ...makeCtx().channels, healthchecksUrl: '', ntfy: null },
    })
    const dispatcher = await createDispatcher(ctx)
    for (let i = 0; i < 3; i++) {
      await dispatcher.dispatchFinding({
        hostId: nextHostId++,
        hostName: `ch-${i}`,
        ruleId: 'fanout-test',
        ruleType: 'threshold',
        ruleTitle: 'Fan-out test',
        severity: 'critical',
        value: 99,
        label: 'too high',
      })
    }
    expect(calls).toEqual([])
    await dispatcher.flushDigests()
    await dispatcher.flushBusEvents()
    expect(calls).toEqual([HOOK_URL])
    expect(dispatcher.counters.alertsDispatched).toBe(3)
  })
})
