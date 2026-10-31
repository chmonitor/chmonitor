/**
 * A Slack digest goes out only when the set of open findings changed (#4246).
 *
 * Every open finding past its cooldown used to come back as a reminder, and a
 * reminder in a Slack bucket forced the full digest. With dozens of findings
 * on staggered cooldown clocks that meant a full digest on nearly every
 * sweep, even when nothing had changed. Now:
 * - nothing changed (only reminders) -> no message;
 * - only resolutions or more findings of an already-open rule -> one delta line;
 * - a new rule or a severity rise -> the full digest.
 */

import type { SweepContext } from '../resolve-config'

import { alertStateStore } from '../../alert-state-store'
import { createDispatcher } from './index'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test'

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/xxxx'
const HOUR = 60 * 60_000
const T0 = new Date('2026-10-20T00:00:00Z').getTime()

const realFetch = globalThis.fetch
let posts: { url: string; body: string }[] = []

beforeEach(() => {
  alertStateStore.clear()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  setSystemTime()
})

function makeCtx(): SweepContext {
  return {
    settings: {
      webhookUrl: SLACK_URL,
      webhookEnabled: true,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: SLACK_URL,
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

type Finding = {
  hostId: number
  ruleId: string
  severity: 'ok' | 'warning' | 'critical'
}

/** One sweep tick at `at`; returns the Slack posts it made. */
async function sweepAt(at: number, findings: Finding[]) {
  setSystemTime(new Date(at))
  posts = []
  const dispatcher = await createDispatcher(makeCtx())
  for (const f of findings) {
    await dispatcher.dispatchFinding({
      hostId: f.hostId,
      hostName: `node-${f.hostId}`,
      ruleId: f.ruleId,
      ruleType: 'threshold',
      ruleTitle: f.ruleId,
      severity: f.severity,
      value: 99,
      label: 'db.events:source-1 too high',
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  return posts.filter((p) => p.url === SLACK_URL)
}

const open: Finding[] = [
  { hostId: 1, ruleId: 'parts-count', severity: 'warning' },
  { hostId: 2, ruleId: 'disk-usage', severity: 'critical' },
]

describe('Slack digest only on a changed open set (#4246)', () => {
  test('an unchanged second sweep sends nothing, even past the cooldown', async () => {
    expect(await sweepAt(T0, open)).toHaveLength(1)
    expect(await sweepAt(T0 + 5 * 60_000, open)).toHaveLength(0)
    // Past the 60 min cooldown every finding is due a reminder: still nothing.
    expect(await sweepAt(T0 + 2 * HOUR, open)).toHaveLength(0)
  })

  test('a resolve-only sweep sends one delta line, not the digest', async () => {
    await sweepAt(T0, open)
    const sent = await sweepAt(T0 + 2 * HOUR, [
      { ...open[0], severity: 'ok' },
      open[1],
    ])
    expect(sent).toHaveLength(1)
    const { text } = JSON.parse(sent[0].body) as { text: string }
    expect(text).toContain('1 resolved')
    expect(text).toContain('1 open')
    expect(text).not.toContain('still open')
  })

  test('a new rule sends the full digest', async () => {
    await sweepAt(T0, open)
    const sent = await sweepAt(T0 + 2 * HOUR, [
      ...open,
      { hostId: 3, ruleId: 'replication-lag', severity: 'warning' },
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toContain('replication-lag')
    expect(sent[0].body).not.toMatch(/\+1 warning · \d+ open/)
  })

  test('a severity rise sends the full digest', async () => {
    await sweepAt(T0, open)
    const sent = await sweepAt(T0 + 10 * 60_000, [
      { ...open[0], severity: 'critical' },
      open[1],
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toContain('parts-count')
  })
})
