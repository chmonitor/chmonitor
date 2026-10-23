/**
 * Opt-in daily digest of long-firing alerts (#4049). Real dispatcher and real
 * alert-state store; only `globalThis.fetch` is stubbed.
 */

import type { SweepContext } from '../resolve-config'

import { alertStateKey, alertStateStore } from '../../alert-state-store'
import { createDispatcher } from './index'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const HOOK = 'https://hooks.example.test/alerts'
const HOUR = 3_600_000

const realFetch = globalThis.fetch
let posts: { url: string; body: string }[] = []
let ok = true
let nextHostId = 920_000

beforeEach(() => {
  posts = []
  ok = true
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response('ok', { status: ok ? 200 : 500 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  // Markers are process-wide state; drop them so tests stay independent.
  for (const [key] of [...alertStateStore.entries()]) {
    if (key.startsWith('-1:')) alertStateStore.delete(key)
  }
})

function makeCtx(overrides: Partial<SweepContext> = {}): SweepContext {
  return {
    settings: {
      webhookUrl: HOOK,
      webhookEnabled: true,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: HOOK,
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
    cooldown: { defaultMs: 60 * 60_000, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    repeatBackoffMaxMs: null,
    longFiringDigestMs: 24 * HOUR,
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

/** An incident that began `openHours` ago and was last notified just now. */
function seedOpenAlert(openHours: number): number {
  const hostId = nextHostId++
  const now = Date.now()
  alertStateStore.set(alertStateKey(hostId, 'disk-usage'), {
    severity: 'critical',
    updatedAt: now - openHours * HOUR,
    notifiedAt: now,
    firstFiredAt: now - openHours * HOUR,
    firstValue: 82.8,
    lastNotifiedValue: 90,
  })
  return hostId
}

/** One sweep tick over the given host. */
async function sweep(ctx: SweepContext, hostId: number) {
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

const markers = () =>
  [...alertStateStore.entries()].filter(([k]) => k.startsWith('-1:'))

describe('long-firing digest', () => {
  test('is off by default: an old alert sends nothing', async () => {
    const hostId = seedOpenAlert(72)
    await sweep(makeCtx({ longFiringDigestMs: null }), hostId)
    expect(posts).toHaveLength(0)
  })

  test('lists a long-open alert with its first and current value', async () => {
    const hostId = seedOpenAlert(30)
    await sweep(makeCtx(), hostId)
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe(HOOK)
    expect(posts[0].body).toContain('Disk usage')
    expect(posts[0].body).toContain('still open, 30 h')
    expect(posts[0].body).toContain('82.8')
    expect(posts[0].body).toContain('91')
  })

  test('an alert younger than the threshold is not listed', async () => {
    const hostId = seedOpenAlert(2)
    await sweep(makeCtx(), hostId)
    expect(posts).toHaveLength(0)
  })

  test('sends one digest per day: later sweeps the same day are silent', async () => {
    const hostId = seedOpenAlert(30)
    await sweep(makeCtx(), hostId)
    await sweep(makeCtx(), hostId)
    await sweep(makeCtx(), hostId)
    expect(posts).toHaveLength(1)
  })

  test('sends again on the next UTC day', async () => {
    const hostId = seedOpenAlert(30)
    await sweep(makeCtx(), hostId)
    const [key, record] = markers()[0]
    alertStateStore.set(key, { ...record, notifiedAt: Date.now() - 25 * HOUR })
    await sweep(makeCtx(), hostId)
    expect(posts).toHaveLength(2)
  })

  test('a failed send is retried, then not repeated once it lands', async () => {
    const hostId = seedOpenAlert(30)
    ok = false
    await sweep(makeCtx(), hostId)
    expect(posts).toHaveLength(1)
    expect(markers()).toHaveLength(0)
    ok = true
    await sweep(makeCtx(), hostId) // retry succeeds
    await sweep(makeCtx(), hostId) // already sent today
    expect(posts).toHaveLength(2)
  })

  test('the marker key carries no webhook URL', async () => {
    const hostId = seedOpenAlert(30)
    await sweep(makeCtx(), hostId)
    expect(markers()).toHaveLength(1)
    expect(markers()[0][0]).not.toContain('example.test')
  })
})
