/**
 * Per-target "once until resolved" (`repeat: false`, #3869) and the one-line
 * reminder in a digest, end to end through the real dispatcher, the real
 * dedup store and the real `HEALTH_ALERT_WEBHOOK_TARGETS` loader.
 *
 * A pager-style target wants the first alert and the recovery, not an hourly
 * reminder, while a chat target on the same rule keeps its reminders. A
 * digest that folds a reminder in should say "still open, 2 h" instead of
 * repeating the whole alert.
 */

import type { SweepContext } from '../resolve-config'

import { alertStateKey, alertStateStore } from '../../alert-state-store'
import { createDispatcher } from './index'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test'

// Public IP literals pass the send-time SSRF guard with no DNS lookup.
const ONCE_URL = 'https://93.184.216.34/once'
const ALWAYS_URL = 'https://93.184.216.34/always'
const ROOM_URL = 'https://93.184.216.34/room'

const ENV_KEYS = [
  'HEALTH_ALERT_WEBHOOK_TARGETS',
  'CHM_TEST_ONCE_URL',
  'CHM_TEST_ALWAYS_URL',
  'CHM_TEST_ROOM_URL',
] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

const realFetch = globalThis.fetch
let posts: { url: string; body: string }[] = []
let nextHostId = 960_000

const HOUR = 60 * 60_000
const T0 = new Date('2026-10-18T00:00:00Z').getTime()

function setTargets(targets: Record<string, unknown>[]) {
  process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify(targets)
}

beforeEach(() => {
  posts = []
  process.env.CHM_TEST_ONCE_URL = ONCE_URL
  process.env.CHM_TEST_ALWAYS_URL = ALWAYS_URL
  process.env.CHM_TEST_ROOM_URL = ROOM_URL
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  setSystemTime()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function makeCtx(): SweepContext {
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
      twilio: null,
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: HOUR, bySeverity: {}, byRule: {} },
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
  }
}

async function sweepAt(
  at: number,
  findings: {
    hostId: number
    ruleId: string
    severity: 'ok' | 'warning' | 'critical'
    label?: string
    value?: number | null
  }[]
) {
  setSystemTime(new Date(at))
  posts = []
  const dispatcher = await createDispatcher(makeCtx())
  for (const f of findings) {
    await dispatcher.dispatchFinding({
      hostId: f.hostId,
      hostName: `ch-${f.hostId}`,
      ruleId: f.ruleId,
      ruleType: 'threshold',
      ruleTitle: f.ruleId,
      severity: f.severity,
      value: f.value === undefined ? 99 : f.value,
      label: f.label ?? 'too high',
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  return posts.map((p) => p.url).sort()
}

describe('custom target repeat: false', () => {
  test('gets the first alert and the recovery, but no reminder', async () => {
    setTargets([
      {
        name: 'once',
        format: 'raw',
        urlEnv: 'CHM_TEST_ONCE_URL',
        repeat: false,
      },
      { name: 'always', format: 'raw', urlEnv: 'CHM_TEST_ALWAYS_URL' },
    ])
    const hostId = nextHostId++
    const f = { hostId, ruleId: 'once-rule' }

    expect(await sweepAt(T0, [{ ...f, severity: 'critical' }])).toEqual([
      ALWAYS_URL,
      ONCE_URL,
    ])
    expect(
      await sweepAt(T0 + 2 * HOUR, [{ ...f, severity: 'critical' }])
    ).toEqual([ALWAYS_URL])
    expect(await sweepAt(T0 + 3 * HOUR, [{ ...f, severity: 'ok' }])).toEqual([
      ALWAYS_URL,
      ONCE_URL,
    ])
  })

  test('a grouped hookshot target with repeat: false skips the reminder too', async () => {
    setTargets([
      {
        name: 'room',
        format: 'hookshot',
        urlEnv: 'CHM_TEST_ROOM_URL',
        repeat: false,
      },
    ])
    const f = { hostId: nextHostId++, ruleId: 'once-grouped' }

    expect(await sweepAt(T0, [{ ...f, severity: 'warning' }])).toEqual([
      ROOM_URL,
    ])
    expect(
      await sweepAt(T0 + 2 * HOUR, [{ ...f, severity: 'warning' }])
    ).toEqual([])
    expect(
      await sweepAt(T0 + 3 * HOUR, [{ ...f, severity: 'critical' }])
    ).toEqual([ROOM_URL])
  })

  test('a skipped reminder still commits, restarting the cooldown clock', async () => {
    setTargets([
      {
        name: 'once',
        format: 'raw',
        urlEnv: 'CHM_TEST_ONCE_URL',
        repeat: false,
      },
    ])
    const hostId = nextHostId++
    const f = { hostId, ruleId: 'once-only' }

    await sweepAt(T0, [{ ...f, severity: 'critical' }])
    await sweepAt(T0 + 2 * HOUR, [{ ...f, severity: 'critical' }])

    expect(
      alertStateStore.get(alertStateKey(hostId, 'once-only'))?.notifiedAt
    ).toBe(T0 + 2 * HOUR)
  })
})

describe('reminder inside a digest', () => {
  test('renders as one "still open" line, not the full alert', async () => {
    setTargets([
      { name: 'room', format: 'hookshot', urlEnv: 'CHM_TEST_ROOM_URL' },
    ])
    const old = { hostId: nextHostId++, ruleId: 'still-firing' }
    const fresh = { hostId: nextHostId++, ruleId: 'just-fired' }

    await sweepAt(T0, [{ ...old, severity: 'warning', label: 'OLD-DETAIL' }])
    await sweepAt(T0 + 3 * HOUR, [
      { ...old, severity: 'warning', label: 'OLD-DETAIL' },
      { ...fresh, severity: 'critical', label: 'NEW-DETAIL' },
    ])

    expect(posts).toHaveLength(1)
    const body = JSON.parse(posts[0].body) as { text: string; html: string }
    expect(body.text).toContain(`ch-${old.hostId} · still open, 3 h`)
    expect(body.html).toContain(`ch-${old.hostId} · still open, 3 h`)
    expect(body.text).not.toContain('OLD-DETAIL')
    expect(body.text).toContain('NEW-DETAIL')
  })

  test('shows how the value moved: previous -> current', async () => {
    setTargets([
      { name: 'room', format: 'hookshot', urlEnv: 'CHM_TEST_ROOM_URL' },
    ])
    const f = { hostId: nextHostId++, ruleId: 'moving' }

    await sweepAt(T0, [{ ...f, severity: 'warning', value: 82.8 }])
    await sweepAt(T0 + 5 * HOUR, [{ ...f, severity: 'warning', value: 82.9 }])

    const body = JSON.parse(posts[0].body) as { text: string; html: string }
    expect(body.text).toContain(
      `ch-${f.hostId} · still open, 5 h (82.8 -> 82.9)`
    )
    expect(body.html).toContain('(82.8 -&gt; 82.9)')
  })

  test('omits the arrow when no previous value was stored', async () => {
    setTargets([
      { name: 'room', format: 'hookshot', urlEnv: 'CHM_TEST_ROOM_URL' },
    ])
    const f = { hostId: nextHostId++, ruleId: 'no-prev' }

    await sweepAt(T0, [{ ...f, severity: 'warning', value: null }])
    await sweepAt(T0 + 2 * HOUR, [{ ...f, severity: 'warning', value: 70 }])

    const body = JSON.parse(posts[0].body) as { text: string }
    expect(body.text).toContain(`ch-${f.hostId} · still open, 2 h`)
    expect(body.text).not.toContain('->')
  })

  test('a new alert in the same digest carries no arrow', async () => {
    setTargets([
      { name: 'room', format: 'hookshot', urlEnv: 'CHM_TEST_ROOM_URL' },
    ])
    const f = { hostId: nextHostId++, ruleId: 'fresh-only' }

    await sweepAt(T0, [
      { ...f, severity: 'warning', value: 10, label: 'NEW-DETAIL' },
    ])

    const body = JSON.parse(posts[0].body) as { text: string }
    expect(body.text).toContain('NEW-DETAIL')
    expect(body.text).not.toContain('->')
    expect(body.text).not.toContain('still open')
  })
})
