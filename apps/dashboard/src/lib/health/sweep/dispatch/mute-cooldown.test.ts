/**
 * Per-rule mute and per-rule re-notify cooldown (#3869), end to end through
 * the real dispatcher and the real dedup store.
 *
 * - A muted rule must reach NO channel: not the legacy webhook, not a custom
 *   target. Other rules keep sending. Muting is how an operator silences one
 *   noisy check without losing the rest of their alerting.
 * - A rule with its own cooldown (`0` = once until resolved/escalated) must
 *   not send reminders even when the global cooldown would, but escalation
 *   and recovery still reach the operator.
 *
 * Outbound traffic is observed by stubbing `globalThis.fetch` (restored after
 * each test). The custom target list is the only module mock, and it is
 * restored in `afterAll` so it never leaks into other files (#3817).
 */

import type { EffectiveCustomWebhookTarget } from '../../custom-webhook-config'
import type { SweepContext } from '../resolve-config'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from 'bun:test'

const WEBHOOK_URL = 'https://hooks.example.test/legacy'
// A public IP literal: passes the send-time SSRF guard with no DNS lookup.
const CUSTOM_URL = 'https://93.184.216.34/custom-hook'

const customTarget = {
  id: 'target-1',
  name: 'custom',
  url: CUSTOM_URL,
  enabled: true,
  format: 'raw-json',
  minSeverity: null,
  titleTemplate: '',
  bodyTemplate: '',
  headers: {},
  secretHeaders: {},
  updatedAt: 0,
  source: 'd1',
  editable: true,
} as unknown as EffectiveCustomWebhookTarget

const realCustomWebhookConfig = {
  ...(await import('../../custom-webhook-config')),
}
mock.module('../../custom-webhook-config', () => ({
  ...realCustomWebhookConfig,
  listEffectiveCustomWebhookConfig: async () => ({
    targets: [customTarget],
    storage: 'ok' as const,
  }),
}))
afterAll(() => {
  mock.module('../../custom-webhook-config', () => ({
    ...realCustomWebhookConfig,
  }))
})

const { createDispatcher } = await import('./index')

const realFetch = globalThis.fetch
let posts: { url: string; body: string }[] = []
let nextHostId = 930_000

beforeEach(() => {
  posts = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  setSystemTime()
})

const HOUR = 60 * 60_000

function makeCtx(overrides: Partial<SweepContext> = {}): SweepContext {
  return {
    settings: {
      webhookUrl: WEBHOOK_URL,
      webhookEnabled: true,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: WEBHOOK_URL,
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
    ...overrides,
  }
}

/** Run one sweep tick for the given findings; returns the dispatcher. */
async function sweep(
  ctx: SweepContext,
  findings: {
    hostId: number
    ruleId: string
    severity: 'ok' | 'warning' | 'critical'
    signalOnly?: boolean
  }[]
) {
  const dispatcher = await createDispatcher(ctx)
  for (const f of findings) {
    await dispatcher.dispatchFinding({
      hostId: f.hostId,
      hostName: 'ch-1',
      ruleId: f.ruleId,
      ruleType: 'threshold',
      ruleTitle: f.ruleId,
      severity: f.severity,
      value: 99,
      label: 'too high',
      signalOnly: f.signalOnly,
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  return dispatcher
}

const postsTo = (url: string, ruleId?: string) =>
  posts.filter(
    (p) => p.url === url && (ruleId === undefined || p.body.includes(ruleId))
  )

describe('signal-only rules', () => {
  // A signal (e.g. one long query) is shown on /health and feeds compound
  // rules, but must never page on its own: only the compound pages.
  test('a signal-only finding reaches no channel, even when critical', async () => {
    const hostId = nextHostId++
    const d = await sweep(makeCtx(), [
      { hostId, ruleId: 'signal-rule', severity: 'critical', signalOnly: true },
      { hostId, ruleId: 'loud-rule', severity: 'critical' },
    ])

    expect(postsTo(WEBHOOK_URL, 'signal-rule')).toHaveLength(0)
    expect(postsTo(CUSTOM_URL, 'signal-rule')).toHaveLength(0)
    expect(postsTo(WEBHOOK_URL, 'loud-rule')).toHaveLength(1)
    expect(d.counters.alertsSuppressed).toBe(1)
    // Counted apart from operator mutes so the summary stays honest.
    expect(d.counters.signalOnlySuppressed).toBe(1)
    expect(d.counters.mutedSuppressed).toBe(0)
  })
})

describe('per-rule mute', () => {
  test('a muted rule reaches no channel; another rule still sends', async () => {
    const hostId = nextHostId++
    const ctx = makeCtx({ mutedRules: ['muted-rule'] })

    const d = await sweep(ctx, [
      { hostId, ruleId: 'muted-rule', severity: 'critical' },
      { hostId, ruleId: 'loud-rule', severity: 'critical' },
    ])

    expect(postsTo(WEBHOOK_URL, 'muted-rule')).toHaveLength(0)
    expect(postsTo(CUSTOM_URL, 'muted-rule')).toHaveLength(0)
    expect(postsTo(WEBHOOK_URL, 'loud-rule')).toHaveLength(1)
    expect(postsTo(CUSTOM_URL, 'loud-rule')).toHaveLength(1)
    expect(d.counters.mutedSuppressed).toBe(1)
    expect(d.counters.alertsSuppressed).toBe(1)
  })

  test('a glob pattern mutes every matching rule', async () => {
    const hostId = nextHostId++
    await sweep(makeCtx({ mutedRules: ['disk-*'] }), [
      { hostId, ruleId: 'disk-usage', severity: 'critical' },
    ])
    expect(posts).toHaveLength(0)
  })

  test('mute does not commit state: unmuting delivers the still-firing condition', async () => {
    const hostId = nextHostId++
    await sweep(makeCtx({ mutedRules: ['flip-rule'] }), [
      { hostId, ruleId: 'flip-rule', severity: 'critical' },
    ])
    expect(posts).toHaveLength(0)

    await sweep(makeCtx(), [
      { hostId, ruleId: 'flip-rule', severity: 'critical' },
    ])
    expect(postsTo(WEBHOOK_URL, 'flip-rule')).toHaveLength(1)
  })

  test('a recovery while muted is dropped: unmuting later sends no stale recovery', async () => {
    const hostId = nextHostId++
    const ruleId = 'recover-muted-rule'

    await sweep(makeCtx(), [{ hostId, ruleId, severity: 'critical' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Condition clears while the rule is muted: nothing is sent.
    await sweep(makeCtx({ mutedRules: [ruleId] }), [
      { hostId, ruleId, severity: 'ok' },
    ])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Unmuted, still clear: the recovery was committed, so no late send.
    await sweep(makeCtx(), [{ hostId, ruleId, severity: 'ok' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)
    expect(postsTo(CUSTOM_URL, ruleId)).toHaveLength(1)
  })
})

describe('per-rule cooldown', () => {
  test('cooldown 0 sends once, no reminders past the global cooldown, then escalation and recovery', async () => {
    const hostId = nextHostId++
    const ruleId = 'once-rule'
    const ctx = makeCtx({
      cooldown: { defaultMs: HOUR, bySeverity: {}, byRule: { [ruleId]: 0 } },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Same severity, well past the 60 min global cooldown: no reminder.
    for (const offset of [61, 125, 300]) {
      setSystemTime(new Date(t0 + offset * 60_000))
      await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    }
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Escalation still sends.
    setSystemTime(new Date(t0 + 301 * 60_000))
    await sweep(ctx, [{ hostId, ruleId, severity: 'critical' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(2)

    // Recovery still sends.
    setSystemTime(new Date(t0 + 302 * 60_000))
    const d = await sweep(ctx, [{ hostId, ruleId, severity: 'ok' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(3)
    expect(d.counters.recoveries).toBe(1)
  })

  test('a rule with no override keeps the global reminder cooldown', async () => {
    const hostId = nextHostId++
    const ruleId = 'global-rule'
    const ctx = makeCtx({
      cooldown: {
        defaultMs: HOUR,
        bySeverity: {},
        byRule: { 'other-rule': 0 },
      },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    setSystemTime(new Date(t0 + 61 * 60_000))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(2)
  })
})

describe('per-severity cooldown (#4049)', () => {
  const MIN = 60_000

  test('warning 0 sends once, but the critical reminder still uses the global cooldown', async () => {
    const hostId = nextHostId++
    const ruleId = 'sev-warn-once'
    const ctx = makeCtx({
      cooldown: { defaultMs: HOUR, bySeverity: { warning: 0 }, byRule: {} },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    setSystemTime(new Date(t0 + 125 * MIN))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Escalation switches to the CURRENT severity's cooldown.
    setSystemTime(new Date(t0 + 126 * MIN))
    await sweep(ctx, [{ hostId, ruleId, severity: 'critical' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(2)
    setSystemTime(new Date(t0 + 126 * MIN + 61 * MIN))
    await sweep(ctx, [{ hostId, ruleId, severity: 'critical' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(3)
  })

  test('critical 10 min reminds sooner than the global cooldown; warning does not', async () => {
    const crit = { hostId: nextHostId++, ruleId: 'sev-crit-fast' }
    const warn = { hostId: nextHostId++, ruleId: 'sev-warn-global' }
    const ctx = makeCtx({
      cooldown: {
        defaultMs: HOUR,
        bySeverity: { critical: 10 * MIN },
        byRule: {},
      },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweep(ctx, [{ ...crit, severity: 'critical' }])
    await sweep(ctx, [{ ...warn, severity: 'warning' }])
    setSystemTime(new Date(t0 + 11 * MIN))
    await sweep(ctx, [{ ...crit, severity: 'critical' }])
    await sweep(ctx, [{ ...warn, severity: 'warning' }])

    expect(postsTo(WEBHOOK_URL, crit.ruleId)).toHaveLength(2)
    expect(postsTo(WEBHOOK_URL, warn.ruleId)).toHaveLength(1)
  })

  test('a per-rule cooldown beats the per-severity one', async () => {
    const hostId = nextHostId++
    const ruleId = 'sev-rule-wins'
    const ctx = makeCtx({
      cooldown: {
        defaultMs: HOUR,
        bySeverity: { warning: 10 * MIN },
        byRule: { [ruleId]: 0 },
      },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    setSystemTime(new Date(t0 + 30 * MIN))
    await sweep(ctx, [{ hostId, ruleId, severity: 'warning' }])
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)
  })
})

describe('repeat min delta (#4049)', () => {
  async function sweepValue(
    ctx: SweepContext,
    hostId: number,
    ruleId: string,
    value: number
  ) {
    const d = await createDispatcher(ctx)
    await d.dispatchFinding({
      hostId,
      hostName: 'ch-1',
      ruleId,
      ruleType: 'threshold',
      ruleTitle: ruleId,
      severity: 'warning',
      value,
      label: 'too high',
    })
    await d.flushDigests()
    await d.flushBusEvents()
  }

  test('skips a reminder when the value barely moved, sends once it moves enough', async () => {
    const hostId = nextHostId++
    const ruleId = 'delta-rule'
    const ctx = makeCtx({
      repeatMinDelta: { default: null, byRule: { [ruleId]: 5 } },
    })
    const t0 = Date.now()

    setSystemTime(new Date(t0))
    await sweepValue(ctx, hostId, ruleId, 90)
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Cooldown elapsed, value moved 2 < 5: no reminder.
    setSystemTime(new Date(t0 + 61 * 60_000))
    await sweepValue(ctx, hostId, ruleId, 92)
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(1)

    // Compared against the last SENT value (90), so 96 is a move of 6.
    setSystemTime(new Date(t0 + 62 * 60_000))
    await sweepValue(ctx, hostId, ruleId, 96)
    expect(postsTo(WEBHOOK_URL, ruleId)).toHaveLength(2)
  })
})
